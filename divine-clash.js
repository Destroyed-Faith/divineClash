/**
 * Divine Clash - A dice-less combat system for Foundry VTT
 */

Hooks.once('init', async function() {
  console.log('Divine Clash | Initializing...');

  // Register Handlebars helpers
  Handlebars.registerHelper('lt', function(a, b) {
    return a < b;
  });
  Handlebars.registerHelper('or', function(a, b) {
    return a || b;
  });
  Handlebars.registerHelper('repeat', function(count, options) {
    let result = '';
    const iterations = Number(count) || 0;
    for (let i = 0; i < iterations; i++) {
      result += options.fn(i);
    }
    return result;
  });

  // Register game settings
  game.settings.register('divine-clash', 'masteryRank', {
    name: 'Default Mastery Rank',
    hint: 'Default regeneration rate for Power Stones',
    scope: 'world',
    config: true,
    type: Number,
    default: 2,
    range: {
      min: 1,
      max: 10
    }
  });

  game.settings.register('divine-clash', 'enableOverdrive', {
    name: 'Enable Overdrive',
    hint: 'Allow players to burn stones for temporary bonuses',
    scope: 'world',
    config: true,
    type: Boolean,
    default: true
  });

  game.settings.register('divine-clash', 'maxGroupDefense', {
    name: 'Max Group Defense Participants',
    hint: 'Maximum number of defenders in a Shared Defense',
    scope: 'world',
    config: true,
    type: Number,
    default: 3,
    range: {
      min: 1,
      max: 10
    }
  });
});

Hooks.once('ready', async function() {
  console.log('Divine Clash | Ready!');
  
  // Register socket for real-time updates
  game.socket.on('module.divine-clash', handleSocketMessage);
});

/**
 * Handle socket messages for real-time synchronization
 */
function handleSocketMessage(data) {
  if (!divineClashManager) return;
  
  switch (data.type) {
    case 'updateAllocation':
      // Allocation updated, refresh UI
      divineClashManager.updateUI();
      break;
    case 'revealAllocations':
      // Allocations revealed, refresh UI
      divineClashManager.updateUI();
      break;
    case 'distributeStones':
      // Stones distributed, refresh UI
      divineClashManager.updateUI();
      break;
    case 'resolveCombat':
      // Combat resolved, refresh UI
      divineClashManager.updateUI();
      break;
    case 'regenerate':
      // Regenerated, refresh UI
      divineClashManager.updateUI();
      break;
    case 'resetAllocation':
      divineClashManager.resetAllocation(data.userId, { broadcast: false });
      break;
  }
}

/**
 * Divine Clash Manager Class
 */
class DivineClashManager {
  constructor() {
    this.activeClash = null;
    this.playerStates = new Map();
    this.roundNumber = 0;
  }

  /**
   * Initialize a new Divine Clash
   */
  async startClash(participants, vitalityCounts = {}, initialStones = {}) {
    this.activeClash = {
      participants: participants,
      roundNumber: 0,
      phase: 'setup'
    };

    // Initialize player states
    for (const participant of participants) {
      const vitality = vitalityCounts[participant.id] ?? 2;
      const stones = initialStones[participant.id] || { attack: 5, defense: 5 };
      
      // Create initial stone pool
      const totalStones = stones.attack + stones.defense;
      const readyStones = Array(totalStones).fill(null).map((_, i) => ({
        id: `stone-${participant.id}-${Date.now()}-${i}`,
        type: 'power'
      }));

      this.playerStates.set(participant.id, {
        userId: participant.id,
        actorId: participant.actorId,
        tokenId: participant.tokenId,
        vitality: vitality,
        vitalityMax: vitality,
        ready: readyStones,
        pending: [],
        exhausted: [],
        burned: [],
        masteryRank: this.getMasteryRank(participant.actorId),
        allocation: {
          attack: 0,
          defense: 0,
          revealed: false,
          ready: false,
          baseAttack: 0,
          baseDefense: 0
        },
        overdrive: {
          active: false,
          attackBonus: 0,
          defenseBonus: 0,
          burnedThisRound: 0
        }
      });
    }

    // Open UI for all participants
    this.openClashUI();
    
    return this.activeClash;
  }

  /**
   * Get mastery rank for an actor
   */
  getMasteryRank(actorId) {
    const actor = game.actors.get(actorId);
    if (!actor) return game.settings.get('divine-clash', 'masteryRank');
    
    // Try to get from actor data, fallback to default
    return actor.system?.masteryRank || 
           actor.getFlag('divine-clash', 'masteryRank') || 
           game.settings.get('divine-clash', 'masteryRank');
  }

  /**
   * Distribute stones to a player
   */
  async distributeStones(userId, stones) {
    const state = this.playerStates.get(userId);
    if (!state) return;

    // Add stones to ready pool
    state.ready.push(...stones);

    // Update UI
    this.updateUI();
    
    // Notify via socket
    game.socket.emit('module.divine-clash', {
      type: 'distributeStones',
      userId: userId,
      stones: stones
    });
  }

  /**
   * Player allocates stones (secret)
   */
  async allocateStones(userId, attack, defense, overdrive = {}) {
    const state = this.playerStates.get(userId);
    if (!state) return;

    // Handle overdrive first (before checking available stones)
    let overdriveBonus = 0;
    let burnedCount = 0;
    
    if (overdrive.active && game.settings.get('divine-clash', 'enableOverdrive')) {
      const burned = overdrive.burned || 0;
      if (burned > 0) {
        // Move stones from ready to burned
        const toBurn = Math.min(burned, state.ready.length);
        for (let i = 0; i < toBurn; i++) {
          state.burned.push(state.ready.pop());
        }
        burnedCount = toBurn;
        // Calculate bonus: +4 per burned stone
        overdriveBonus = toBurn * 4;
        state.overdrive = {
          active: true,
          attackBonus: overdrive.attackBonus || overdriveBonus,
          defenseBonus: overdrive.defenseBonus || 0,
          burnedThisRound: toBurn
        };
      }
    }

    // Check allocation (base attack + defense, not including overdrive bonus)
    const totalAllocated = attack + defense;
    const available = state.ready.length;

    // Check if allocation is valid
    if (totalAllocated > available) {
      ui.notifications.error(`Not enough stones! Available: ${available}, Allocated: ${totalAllocated}`);
      return false;
    }

    // Move stones from ready to pending (committed this round)
    const committedStones = state.ready.splice(0, totalAllocated);
    state.pending = state.pending || [];
    state.pending.push(...committedStones);

    // Set allocation (overdrive bonus is added to the displayed values)
    state.allocation = {
      attack: attack + (state.overdrive?.attackBonus || 0),
      defense: defense + (state.overdrive?.defenseBonus || 0),
      revealed: false,
      baseAttack: attack,
      baseDefense: defense,
      ready: true
    };

    // Update UI
    this.updateUI();

    // Broadcast allocation (but keep it hidden from other players)
    game.socket.emit('module.divine-clash', {
      type: 'updateAllocation',
      userId: userId,
      allocation: state.allocation
    });

    return true;
  }
  
  /**
   * Reset allocation for a player (moves pending stones back to ready)
   */
  async resetAllocation(userId, { broadcast = true } = {}) {
    const state = this.playerStates.get(userId);
    if (!state || !state.allocation.ready) return false;

    if (state.pending?.length) {
      state.ready.unshift(...state.pending);
      state.pending = [];
    }

    state.allocation = { attack: 0, defense: 0, revealed: false, baseAttack: 0, baseDefense: 0, ready: false };
    state.overdrive = { active: false, attackBonus: 0, defenseBonus: 0, burnedThisRound: 0 };

    this.updateUI();

    if (broadcast) {
      game.socket.emit('module.divine-clash', {
        type: 'resetAllocation',
        userId: userId
      });
    }

    return true;
  }

  /**
   * Reveal all allocations
   */
  async revealAllocations() {
    const allocations = {};
    
    for (const [userId, state] of this.playerStates) {
      state.allocation.revealed = true;
      allocations[userId] = {
        attack: state.allocation.attack,
        defense: state.allocation.defense,
        overdrive: state.overdrive.active
      };
    }

    // Broadcast reveal
    game.socket.emit('module.divine-clash', {
      type: 'revealAllocations',
      allocations: allocations
    });

    this.updateUI();
    return allocations;
  }

  /**
   * Resolve combat between participants
   */
  async resolveCombat() {
    const results = [];
    const participants = Array.from(this.playerStates.keys());

    // Resolve each pair
    for (let i = 0; i < participants.length; i++) {
      for (let j = i + 1; j < participants.length; j++) {
        const attackerId = participants[i];
        const defenderId = participants[j];
        
        const attacker = this.playerStates.get(attackerId);
        const defender = this.playerStates.get(defenderId);

        // Attack 1 -> 2
        const damage1 = Math.max(0, attacker.allocation.attack - defender.allocation.defense);
        if (damage1 > 0) {
          defender.vitality = Math.max(0, defender.vitality - damage1);
          results.push({
            attacker: attackerId,
            defender: defenderId,
            damage: damage1
          });
        }

        // Attack 2 -> 1
        const damage2 = Math.max(0, defender.allocation.attack - attacker.allocation.defense);
        if (damage2 > 0) {
          attacker.vitality = Math.max(0, attacker.vitality - damage2);
          results.push({
            attacker: defenderId,
            defender: attackerId,
            damage: damage2
          });
        }
      }
    }

    // Move allocated stones to exhausted
    for (const state of this.playerStates.values()) {
      // Use base allocation (without overdrive bonus) for moving stones
      const pendingStones = state.pending || [];
      for (const stone of pendingStones) {
        state.exhausted.push(stone);
      }
      state.pending = [];

      // Update mastery rank if stones were burned
      if (state.overdrive.burnedThisRound > 0) {
        state.masteryRank = Math.max(1, state.masteryRank - state.overdrive.burnedThisRound);
      }

      // Reset allocation
      state.allocation = { attack: 0, defense: 0, revealed: false, baseAttack: 0, baseDefense: 0, ready: false };
      state.overdrive = { active: false, attackBonus: 0, defenseBonus: 0, burnedThisRound: 0 };
    }

    // Broadcast results
    game.socket.emit('module.divine-clash', {
      type: 'resolveCombat',
      results: results
    });

    this.updateUI();
    return results;
  }

  /**
   * Regenerate exhausted stones
   */
  async regenerate() {
    for (const state of this.playerStates.values()) {
      const masteryRank = state.masteryRank;
      const burnedCount = state.burned.length;
      const effectiveRegen = Math.max(1, masteryRank - burnedCount);
      
      const toRegenerate = Math.min(effectiveRegen, state.exhausted.length);
      
      for (let i = 0; i < toRegenerate; i++) {
        state.ready.push(state.exhausted.pop());
      }
    }

    game.socket.emit('module.divine-clash', {
      type: 'regenerate'
    });

    this.updateUI();
  }

  /**
   * Handle team combined attack
   */
  async combinedAttack(attackerIds, targetId) {
    let totalAttack = 0;
    let leadAttacker = null;

    for (const attackerId of attackerIds) {
      const state = this.playerStates.get(attackerId);
      if (!state) continue;
      
      totalAttack += state.allocation.attack;
      if (!leadAttacker) leadAttacker = attackerId;
    }

    const defender = this.playerStates.get(targetId);
    if (!defender) return;

    const damage = Math.max(0, totalAttack - defender.allocation.defense);
    
    if (damage > 0) {
      defender.vitality = Math.max(0, defender.vitality - damage);
    }

    return { damage, leadAttacker };
  }

  /**
   * Handle group defense
   */
  async groupDefense(defenderIds, attackerId) {
    const maxDefenders = game.settings.get('divine-clash', 'maxGroupDefense');
    const actualDefenders = defenderIds.slice(0, maxDefenders);

    let totalDefense = 0;
    for (const defenderId of actualDefenders) {
      const state = this.playerStates.get(defenderId);
      if (!state) continue;
      totalDefense += state.allocation.defense;
    }

    const attacker = this.playerStates.get(attackerId);
    if (!attacker) return;

    const damage = Math.max(0, attacker.allocation.attack - totalDefense);
    
    if (damage > 0) {
      // Distribute damage evenly
      const damagePerDefender = Math.floor(damage / actualDefenders.length);
      const remainder = damage % actualDefenders.length;

      for (let i = 0; i < actualDefenders.length; i++) {
        const state = this.playerStates.get(actualDefenders[i]);
        const damageToTake = damagePerDefender + (i < remainder ? 1 : 0);
        state.vitality = Math.max(0, state.vitality - damageToTake);
      }
    }

    return { totalDefense, damage };
  }

  /**
   * Open the Clash UI
   */
  openClashUI() {
    if (!this.ui) {
      this.ui = new DivineClashUI(this);
    }
    this.ui.render(true);
  }

  /**
   * Update the UI
   */
  updateUI() {
    if (this.ui) {
      this.ui.render();
    }
  }

  /**
   * Get player state
   */
  getPlayerState(userId) {
    return this.playerStates.get(userId);
  }

  /**
   * Get all player states
   */
  getAllStates() {
    return Array.from(this.playerStates.values());
  }
}

/**
 * Divine Clash UI Application
 */
class DivineClashUI extends Application {
  constructor(manager) {
    super();
    this.manager = manager;
    this.draggedElement = null;
  }

  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, {
      id: 'divine-clash-ui',
      title: 'Divine Clash',
      template: 'modules/divine-clash/templates/divine-clash-ui.html',
      width: 900,
      height: 700,
      resizable: true,
      minimizable: true,
      tabs: []
    });
  }

  getData() {
    const states = this.manager.getAllStates();
    const currentUserId = game.userId;
    const isGM = game.user.isGM;

    const participants = states.map(state => {
      const actor = game.actors.get(state.actorId);
      const actorName = actor ? actor.name : `User ${state.userId}`;
      const isOwner = state.userId === currentUserId;

      return {
        userId: state.userId,
        actorId: state.actorId,
        actorName: actorName,
        vitality: state.vitality,
        vitalityMax: state.vitalityMax,
        ready: state.ready,
        exhausted: state.exhausted,
        burned: state.burned,
        masteryRank: state.masteryRank,
        allocation: {
          attack: state.allocation?.attack || 0,
          defense: state.allocation?.defense || 0,
          revealed: state.allocation?.revealed || false,
          ready: !!state.allocation?.ready
        },
        overdrive: state.overdrive,
        isOwner: isOwner
      };
    });

    const readySummary = {
      ready: participants.filter(p => p.allocation.ready).length,
      total: participants.length
    };

    return {
      participants: participants,
      isGM: isGM,
      currentUserId: currentUserId,
      readySummary
    };
  }

  activateListeners(html) {
    super.activateListeners(html);

    // Clash controls
    html.find('.reveal-btn').on('click', this._onReveal.bind(this));
    html.find('.resolve-btn').on('click', this._onResolve.bind(this));
    html.find('.regenerate-btn').on('click', this._onRegenerate.bind(this));

    // GM controls
    html.find('.distribute-btn').on('click', this._onDistributeStones.bind(this));

    // Player distribution controls
    html.find('.finish-btn').on('click', this._onFinishDistribution.bind(this));
    html.find('.reset-allocation-btn').on('click', this._onResetDistribution.bind(this));

    // Drag and drop for stones
    html.on('dragstart', '.stone-draggable', this._onStoneDragStart.bind(this));
    html.on('dragend', '.stone-draggable', this._onStoneDragEnd.bind(this));
    html.on('dragover', '.stone-drop-zone', this._onStoneDragOver.bind(this));
    html.on('dragleave', '.stone-drop-zone', this._onStoneDragLeave.bind(this));
    html.on('drop', '.stone-drop-zone', this._onStoneDrop.bind(this));

    // Overdrive
    html.find('.overdrive-checkbox').on('change', this._onOverdriveToggle.bind(this));

    // Team actions
    html.find('.combined-attack-btn').on('click', this._onCombinedAttack.bind(this));
    html.find('.group-defense-btn').on('click', this._onGroupDefense.bind(this));

    this._initializeBoards(html);
  }

  _initializeBoards(html) {
    html.find('.participant-panel[data-owner="true"]').each((_, element) => {
      const panel = $(element);
      if (!panel.find('.distribution-board').length) return;
      this._updateDistributionState(panel);
    });
  }

  async _onReveal(event) {
    if (!game.user.isGM) {
      ui.notifications.error('Only the GM can reveal allocations');
      return;
    }

    const allocations = await this.manager.revealAllocations();
    ui.notifications.info('Allocations revealed!');
  }

  async _onResolve(event) {
    if (!game.user.isGM) {
      ui.notifications.error('Only the GM can resolve combat');
      return;
    }

    const results = await this.manager.resolveCombat();
    
    // Show results
    let message = 'Combat Results:\n';
    for (const result of results) {
      const attacker = game.users.get(result.attacker);
      const defender = game.users.get(result.defender);
      message += `${attacker?.name || 'Unknown'} dealt ${result.damage} damage to ${defender?.name || 'Unknown'}\n`;
    }
    
    ui.notifications.info(message);
    
    // Check for defeat
    const states = this.manager.getAllStates();
    for (const state of states) {
      if (state.vitality <= 0) {
        const actor = game.actors.get(state.actorId);
        ui.notifications.warn(`${actor?.name || 'Unknown'} has been defeated!`);
      }
    }
  }

  async _onRegenerate(event) {
    if (!game.user.isGM) {
      ui.notifications.error('Only the GM can trigger regeneration');
      return;
    }

    await this.manager.regenerate();
    ui.notifications.info('Stones regenerated!');
  }

  async _onDistributeStones(event) {
    if (!game.user.isGM) {
      ui.notifications.error('Only the GM can distribute stones');
      return;
    }

    const button = $(event.currentTarget);
    const userId = button.data('user-id');
    const count = parseInt(button.siblings('.stone-count-input').val()) || 5;

    // Create stones (simple objects for now)
    const stones = Array(count).fill(null).map((_, i) => ({
      id: `stone-${Date.now()}-${i}`,
      type: 'power'
    }));

    await this.manager.distributeStones(userId, stones);
    ui.notifications.info(`Distributed ${count} stones`);
  }

  async _onFinishDistribution(event) {
    const panel = $(event.currentTarget).closest('.participant-panel');
    const userId = panel.data('user-id');
    const isOwner = panel.data('owner');
    if (!isOwner) return;

    const readyZone = panel.find('.ready-zone .stone-zone-body');
    const readyCount = readyZone.children('.stone-draggable').length;
    if (readyCount > 0) {
      ui.notifications.warn('Verteile alle Steine auf Angriff und Verteidigung, bevor du abschließt.');
      return;
    }

    const attackCount = panel.find('.attack-zone .stone-zone-body .stone-draggable').length;
    const defenseCount = panel.find('.defense-zone .stone-zone-body .stone-draggable').length;

    const overdrive = {
      active: panel.find('.overdrive-checkbox').is(':checked'),
      burned: parseInt(panel.find('.burn-input').val()) || 0,
      attackBonus: parseInt(panel.find('.attack-bonus-input').val()) || 0,
      defenseBonus: parseInt(panel.find('.defense-bonus-input').val()) || 0
    };

    const success = await this.manager.allocateStones(userId, attackCount, defenseCount, overdrive);
    if (success) {
      ui.notifications.info('Verteilung abgeschlossen!');
      this.render(false);
    }
  }

  async _onResetDistribution(event) {
    const panel = $(event.currentTarget).closest('.participant-panel');
    const userId = panel.data('user-id');
    await this.manager.resetAllocation(userId);
  }

  _onStoneDragStart(event) {
    const panel = $(event.currentTarget).closest('.participant-panel');
    if (!panel.data('owner')) return;
    this.draggedElement = event.currentTarget;
    const dataTransfer = event.originalEvent?.dataTransfer;
    if (dataTransfer) {
      dataTransfer.setData('text/plain', $(event.currentTarget).data('stone-id') || 'stone');
      dataTransfer.effectAllowed = 'move';
    }
    event.currentTarget.classList.add('dragging');
  }

  _onStoneDragEnd(event) {
    event.currentTarget.classList.remove('dragging');
    this.draggedElement = null;
  }

  _onStoneDragOver(event) {
    const panel = $(event.currentTarget).closest('.participant-panel');
    if (!panel.data('owner')) return;
    event.preventDefault();
    const zone = $(event.currentTarget).hasClass('stone-drop-zone')
      ? $(event.currentTarget)
      : $(event.currentTarget).closest('.stone-drop-zone');
    zone.addClass('drop-active');
  }

  _onStoneDragLeave(event) {
    const zone = $(event.currentTarget).hasClass('stone-drop-zone')
      ? $(event.currentTarget)
      : $(event.currentTarget).closest('.stone-drop-zone');
    zone.removeClass('drop-active');
  }

  _onStoneDrop(event) {
    event.preventDefault();
    const panel = $(event.currentTarget).closest('.participant-panel');
    const zone = $(event.currentTarget).hasClass('stone-drop-zone')
      ? $(event.currentTarget)
      : $(event.currentTarget).closest('.stone-drop-zone');
    zone.removeClass('drop-active');

    if (!panel.data('owner')) return;
    if (!this.draggedElement) return;

    const targetBody = zone.find('.stone-zone-body');
    targetBody.append(this.draggedElement);
    this.draggedElement = null;
    this._updateDistributionState(panel);
  }

  _updateDistributionState(panel) {
    if (!panel || !panel.length) return;
    const attackCount = panel.find('.attack-zone .stone-zone-body .stone-draggable').length;
    const defenseCount = panel.find('.defense-zone .stone-zone-body .stone-draggable').length;
    const readyCount = panel.find('.ready-zone .stone-zone-body .stone-draggable').length;

    panel.find('.attack-zone .zone-count').text(attackCount);
    panel.find('.defense-zone .zone-count').text(defenseCount);
    panel.find('.ready-zone .zone-count').text(readyCount);

    const finishBtn = panel.find('.finish-btn');
    if (finishBtn.length) {
      finishBtn.prop('disabled', readyCount > 0);
    }
  }

  _onOverdriveToggle(event) {
    const checked = $(event.currentTarget).is(':checked');
    const panel = $(event.currentTarget).closest('.participant-panel');
    panel.find('.overdrive-inputs').toggle(checked);
    
    // Calculate bonus based on burned stones
    if (checked) {
      const burnInput = panel.find('.burn-input');
      burnInput.on('input', function() {
        const burned = parseInt($(this).val()) || 0;
        const bonus = burned * 4;
        panel.find('.attack-bonus-input').val(bonus);
        panel.find('.defense-bonus-input').val(0);
      });
    }
  }

  async _onCombinedAttack(event) {
    // Open dialog to select attackers and target
    const dialog = new CombinedAttackDialog(this.manager);
    dialog.render(true);
  }

  async _onGroupDefense(event) {
    // Open dialog to select defenders and attacker
    const dialog = new GroupDefenseDialog(this.manager);
    dialog.render(true);
  }
}

/**
 * Combined Attack Dialog
 */
class CombinedAttackDialog extends Dialog {
  constructor(manager) {
    super({
      title: 'Combined Attack',
      content: this._getContent(),
      buttons: {
        attack: {
          label: 'Execute Attack',
          callback: async (html) => {
            const attackerIds = [];
            html.find('input[type="checkbox"][data-type="attacker"]:checked').each(function() {
              attackerIds.push($(this).data('user-id'));
            });
            const targetId = html.find('input[type="radio"][name="target"]:checked').val();

            if (attackerIds.length < 2) {
              ui.notifications.error('Select at least 2 attackers');
              return false;
            }

            if (!targetId) {
              ui.notifications.error('Select a target');
              return false;
            }

            const result = await manager.combinedAttack(attackerIds, targetId);
            ui.notifications.info(`Combined attack dealt ${result.damage} damage!`);
            manager.updateUI();
          }
        },
        cancel: {
          label: 'Cancel'
        }
      }
    });
    this.manager = manager;
  }

  _getContent() {
    const states = this.manager.getAllStates();
    let content = '<div class="combined-attack-dialog">';
    content += '<h3>Select Attackers:</h3>';
    
    for (const state of states) {
      const actor = game.actors.get(state.actorId);
      content += `<label><input type="checkbox" data-type="attacker" data-user-id="${state.userId}"> ${actor?.name || 'Unknown'}</label><br>`;
    }

    content += '<h3>Select Target:</h3>';
    for (const state of states) {
      const actor = game.actors.get(state.actorId);
      content += `<label><input type="radio" name="target" value="${state.userId}"> ${actor?.name || 'Unknown'}</label><br>`;
    }

    content += '</div>';
    return content;
  }
}

/**
 * Group Defense Dialog
 */
class GroupDefenseDialog extends Dialog {
  constructor(manager) {
    super({
      title: 'Group Defense',
      content: this._getContent(),
      buttons: {
        defend: {
          label: 'Execute Defense',
          callback: async (html) => {
            const defenderIds = [];
            html.find('input[type="checkbox"][data-type="defender"]:checked').each(function() {
              defenderIds.push($(this).data('user-id'));
            });
            const attackerId = html.find('input[type="radio"][name="attacker"]:checked').val();

            if (defenderIds.length < 2) {
              ui.notifications.error('Select at least 2 defenders');
              return false;
            }

            if (!attackerId) {
              ui.notifications.error('Select an attacker');
              return false;
            }

            const result = await manager.groupDefense(defenderIds, attackerId);
            ui.notifications.info(`Group defense blocked ${result.totalDefense} attack, took ${result.damage} damage!`);
            manager.updateUI();
          }
        },
        cancel: {
          label: 'Cancel'
        }
      }
    });
    this.manager = manager;
  }

  _getContent() {
    const states = this.manager.getAllStates();
    let content = '<div class="group-defense-dialog">';
    content += '<h3>Select Defenders:</h3>';
    
    for (const state of states) {
      const actor = game.actors.get(state.actorId);
      content += `<label><input type="checkbox" data-type="defender" data-user-id="${state.userId}"> ${actor?.name || 'Unknown'}</label><br>`;
    }

    content += '<h3>Select Attacker:</h3>';
    for (const state of states) {
      const actor = game.actors.get(state.actorId);
      content += `<label><input type="radio" name="attacker" value="${state.userId}"> ${actor?.name || 'Unknown'}</label><br>`;
    }

    content += '</div>';
    return content;
  }
}

/**
 * Start Clash Dialog
 */
class StartClashDialog extends Dialog {
  static getContent() {
    // Get selected tokens from the canvas
    const selectedTokens = canvas.tokens.controlled;
    
    if (selectedTokens.length === 0) {
      return '<div class="start-clash-dialog"><p style="color: red;">Bitte wähle zuerst Tokens auf der Map aus!</p></div>';
    }

    let content = '<div class="start-clash-dialog">';
    content += '<p>Teilnehmer aus ausgewählten Tokens:</p>';
    content += '<table><thead><tr><th>Select</th><th>Token</th><th>Vitality</th><th>Active Stones (Attack)</th><th>Active Stones (Defense)</th></tr></thead><tbody>';

    for (const token of selectedTokens) {
      const actor = token.actor;
      const tokenDoc = token.document ?? token;
      if (!actor) continue;

      // Get the first player owner or use GM
      let userId = null;
      if (game.user.isGM) {
        userId = game.userId;
      } else if (actor.hasPlayerOwner) {
        const owners = Object.entries(actor.ownership || {})
          .filter(([id, level]) => level >= 3)
          .map(([id]) => game.users.get(id))
          .filter(u => u && u.active);
        if (owners.length > 0) {
          userId = owners[0].id;
        }
      }

      if (userId || game.user.isGM) {
        const tokenName = token.name || actor.name || 'Unknown';
        const playerName = userId ? game.users.get(userId)?.name || 'Unknown' : 'GM';
        
        // Get values from token flags or defaults
        const vitality = (tokenDoc.getFlag?.('divine-clash', 'vitality')) ?? 
                        (actor.getFlag?.('divine-clash', 'vitality')) ?? 2;
        const attackStones = (tokenDoc.getFlag?.('divine-clash', 'attackStones')) ?? 
                            (actor.getFlag?.('divine-clash', 'attackStones')) ?? 5;
        const defenseStones = (tokenDoc.getFlag?.('divine-clash', 'defenseStones')) ?? 
                             (actor.getFlag?.('divine-clash', 'defenseStones')) ?? 5;
        
        content += `<tr>
          <td><input type="checkbox" data-user-id="${userId || game.userId}" data-actor-id="${actor.id}" data-token-id="${token.id}" checked></td>
          <td>${tokenName} (${playerName})</td>
          <td><input type="number" class="vitality-input" value="${vitality}" min="1" max="50"></td>
          <td><input type="number" class="attack-stones-input" value="${attackStones}" min="0" max="50"></td>
          <td><input type="number" class="defense-stones-input" value="${defenseStones}" min="0" max="50"></td>
        </tr>`;
      }
    }

    content += '</tbody></table></div>';
    return content;
  }

  constructor() {
    super({
      title: 'Start Divine Clash',
      content: StartClashDialog.getContent(),
      buttons: {
        start: {
          label: 'Start Clash',
          callback: async (html) => {
            const participants = [];
            const vitalityCounts = {};
            const initialStones = {};

            html.find('input[type="checkbox"]:checked').each(function() {
              const userId = $(this).data('user-id');
              const actorId = $(this).data('actor-id');
              const tokenId = $(this).data('token-id');
              const row = $(this).closest('tr');
              
              const vitality = parseInt(row.find('.vitality-input').val()) || 2;
              const attackStones = parseInt(row.find('.attack-stones-input').val()) || 5;
              const defenseStones = parseInt(row.find('.defense-stones-input').val()) || 5;
              
              participants.push({ id: userId, actorId: actorId, tokenId: tokenId });
              vitalityCounts[userId] = vitality;
              initialStones[userId] = { attack: attackStones, defense: defenseStones };
            });

            if (participants.length < 2) {
              ui.notifications.error('Select at least 2 participants');
              return false;
            }

            await divineClashManager.startClash(participants, vitalityCounts, initialStones);
          }
        },
        cancel: {
          label: 'Cancel'
        }
      }
    });
  }
}

// Global instance
let divineClashManager = null;

/**
 * Initialize manager
 */
Hooks.once('ready', async function() {
  divineClashManager = new DivineClashManager();
  
  // Add menu button
  Hooks.on('getSceneControlButtons', (controls) => {
    const tokenControls = controls.find(c => c.name === 'token');
    if (tokenControls) {
      tokenControls.tools.push({
        name: 'divine-clash',
        title: 'Divine Clash',
        icon: 'fas fa-gem',
        button: true,
        onClick: () => {
          if (divineClashManager.activeClash) {
            divineClashManager.openClashUI();
          } else {
            new StartClashDialog().render(true);
          }
        }
      });
    }
  });
});

/**
 * API for other modules
 */
window.DivineClash = {
  getManager: () => divineClashManager,
  startClash: (participants, vitalityCounts) => divineClashManager?.startClash(participants, vitalityCounts),
  distributeStones: (userId, stones) => divineClashManager?.distributeStones(userId, stones),
  resetAllocation: (userId) => divineClashManager?.resetAllocation(userId)
};

