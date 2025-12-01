# Divine Clash - Foundry VTT Module

Ein Foundry VTT Modul für das Divine Clash Kampfsystem, bei dem Spieler Steine statt Würfel verwenden.

## Features

- **Steinverwaltung**: Verwaltung von Vitality Stones (HP) und Power Stones (Angriff/Verteidigung)
- **Geheime Zuteilung**: Spieler können ihre Steine verdeckt auf Angriff und Verteidigung aufteilen
- **Gleichzeitiges Aufdecken**: Alle Zuteilungen werden gleichzeitig aufgedeckt
- **Kampfauflösung**: Automatische Berechnung von Schaden basierend auf Overhang
- **Regeneration**: Automatische Regeneration erschöpfter Steine basierend auf Mastery Rank
- **Team-Mechaniken**: Kombinierte Angriffe und Gruppenverteidigung
- **Overdrive**: Optionale Regel zum Verbrennen von Steinen für temporäre Boni
- **GM-Kontrollen**: Spielleiter kann Steine verteilen und den Kampf verwalten

## Installation

1. Kopiere diesen Ordner in dein `Data/modules/` Verzeichnis
2. Starte Foundry VTT neu oder lade die Welt neu
3. Aktiviere das Modul in den Moduleinstellungen

## Verwendung

### Kampf starten

1. Klicke auf das Divine Clash Symbol in der Token-Leiste
2. Wähle die Teilnehmer aus dem Dialog
3. Setze die Vitality für jeden Teilnehmer
4. Klicke auf "Start Clash"

### Steine verteilen (GM)

1. Als GM siehst du für jeden Teilnehmer einen "Distribute Stones" Button
2. Gib die Anzahl der Steine ein, die du verteilen möchtest
3. Klicke auf "Distribute Stones"

### Steine zuteilen (Spieler)

1. Gib die Anzahl der Steine für Angriff und Verteidigung ein
2. (Optional) Aktiviere Overdrive für temporäre Boni
3. Klicke auf "Allocate"

### Kampf auflösen (GM)

1. Klicke auf "Reveal Allocations" um alle Zuteilungen aufzudecken
2. Klicke auf "Resolve Combat" um den Kampf aufzulösen
3. Klicke auf "Regenerate" um erschöpfte Steine zu regenerieren

### Team-Aktionen (GM)

- **Combined Attack**: Mehrere Spieler können ihre Angriffssteine kombinieren
- **Group Defense**: Mehrere Spieler können ihre Verteidigungssteine kombinieren

## Einstellungen

- **Default Mastery Rank**: Standard-Regenerationsrate (Standard: 2)
- **Enable Overdrive**: Aktiviert die Overdrive-Regel (Standard: aktiviert)
- **Max Group Defense Participants**: Maximale Anzahl von Verteidigern in einer Gruppenverteidigung (Standard: 3)

## Spielmechanik

### Kernschleife

1. **Build Pool**: Alle Ready Power Stones sind verfügbar
2. **Allocate**: Geheime Aufteilung in Angriff (A) und Verteidigung (D)
3. **Reveal**: Gleichzeitiges Aufdecken aller Zuteilungen
4. **Resolve**: Vergleich A vs. D → Schaden = Overhang (A - D)
5. **Exhaust**: Alle verwendeten Steine werden erschöpft
6. **Regenerate**: Regeneriere Steine basierend auf Mastery Rank

### Overdrive

- Für jeden verbrannten Power Stone: +4 temporärer Angriffs- oder Verteidigungsbonus
- Verbrannte Steine reduzieren die Regenerationsrate dauerhaft
- Regenerationsrate kann nie unter 1 fallen

## Entwicklung

Dieses Modul wurde für Foundry VTT v10+ entwickelt.

## Lizenz

Siehe LICENSE Datei (falls vorhanden)

