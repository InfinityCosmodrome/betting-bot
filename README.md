# Betting Bot

Node.js script που μαζεύει football betting data από το API-FOOTBALL και επιστρέφει JSON με:

- fixtures για συγκεκριμένη ημερομηνία και χρονικό παράθυρο
- predictions ανά fixture
- standings της λίγκας
- team statistics
- head-to-head ιστορικό
- pre-match odds όπου υπάρχουν
- heuristic ranking για top 2 επιλογές
- προτεινόμενα 2 picks με confidence και σύντομη αιτιολόγηση

## Setup

1. Εγκατάστησε dependencies:

```bash
npm install
```

2. Βάλε το API key σου:

Windows Command Prompt:

```bat
set API_FOOTBALL_KEY=TO_API_KEY_SOU
```

PowerShell:

```powershell
$env:API_FOOTBALL_KEY="TO_API_KEY_SOU"
```

Μπορείς επίσης να αντιγράψεις το `.env.example` σαν αναφορά, αλλά το script διαβάζει το key από environment variable.

Εναλλακτικά μπορείς να δημιουργήσεις αρχείο `.env` στο root του project με:

```env
API_FOOTBALL_KEY=TO_API_KEY_SOU
```

Το `.env.example` είναι μόνο παράδειγμα και δεν διαβάζεται αυτόματα.

## Χρήση

```bash
node betting-data.js --date 2026-03-29 --from 19:00 --to 20:00
```

ή:

```bash
node betting-data.js --date 2026-03-29 --from 19:00 --to 20:00 --timezone Europe/Athens --limit 10
```

ή με συγκεκριμένο output path:

```bash
node betting-data.js --date 2026-03-29 --from 19:00 --to 20:00 --output "C:\\Users\\djsfa\\Downloads\\response.json"
```

## Output

Το script επιστρέφει compact JSON με:

- `recommendedTop2Picks`
- `allMatches`
- βασικά fixture στοιχεία
- league / round
- συνοπτικά standings home / away
- βασικά statistics
- prediction / advice / probabilities
- h2h τελευταίων 3 αγώνων
- καλύτερες 1X2 odds που βρέθηκαν

Αν δεν δώσεις `--output`, το script αποθηκεύει αυτόματα το JSON στα `Downloads`.

## Σημείωση

Το `recommendedTop2` βασίζεται σε heuristic scoring και όχι σε εγγυημένη πρόβλεψη.
