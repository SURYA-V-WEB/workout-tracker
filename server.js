import express from 'express';
import { DatabaseSync } from 'node:sqlite';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const dbPath = path.resolve(__dirname, 'workout.db');

// Initialize database
const db = new DatabaseSync(dbPath);

// Create tables if they do not exist
db.exec(`
  CREATE TABLE IF NOT EXISTS workout_days (
    id TEXT PRIMARY KEY,
    label TEXT NOT NULL,
    type TEXT NOT NULL,
    tagline TEXT NOT NULL
  );
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS exercises (
    id TEXT PRIMARY KEY,
    day_id TEXT NOT NULL,
    number INTEGER NOT NULL,
    name TEXT NOT NULL,
    sets INTEGER NOT NULL,
    reps TEXT NOT NULL,
    targets TEXT NOT NULL,
    FOREIGN KEY (day_id) REFERENCES workout_days(id) ON DELETE CASCADE
  );
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS checklist_state (
    exercise_id TEXT PRIMARY KEY,
    sets_state TEXT NOT NULL, -- JSON string of boolean array, e.g. "[true, false]"
    FOREIGN KEY (exercise_id) REFERENCES exercises(id) ON DELETE CASCADE
  );
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS workout_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    date TEXT NOT NULL, -- ISO date string
    day_id TEXT NOT NULL,
    completed_sets INTEGER NOT NULL,
    total_sets INTEGER NOT NULL
  );
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
`);

// Seed default data if empty
const dayCount = db.prepare("SELECT count(*) as count FROM workout_days").get();
if (dayCount.count === 0) {
  console.log("Seeding initial workouts data into SQLite database...");

  // Seed workout days
  const insertDay = db.prepare("INSERT INTO workout_days (id, label, type, tagline) VALUES (?, ?, ?, ?)");
  insertDay.run("push", "PUSH", "PUSH", "Slow, Controlled Tension");
  insertDay.run("pull", "PULL", "PULL", "Slow, Controlled Tension");
  insertDay.run("legs", "LEGS", "LEGS", "Slow, Controlled Tension");

  // Seed exercises
  const insertExercise = db.prepare(
    "INSERT INTO exercises (id, day_id, number, name, sets, reps, targets) VALUES (?, ?, ?, ?, ?, ?, ?)"
  );
  const insertChecklist = db.prepare("INSERT INTO checklist_state (exercise_id, sets_state) VALUES (?, ?)");

  const initialWorkouts = [
    {
      day_id: "push",
      exercises: [
        { id: "pu1", number: 1, name: "Push-Ups", sets: 4, reps: "10–20", targets: "Chest, Shoulders, Triceps" },
        { id: "pu2", number: 2, name: "Incline Push-Ups", sets: 3, reps: "10–20", targets: "Lower Chest, Triceps" },
        { id: "pu3", number: 3, name: "Pike Push-Ups", sets: 3, reps: "8–15", targets: "Shoulders" },
        { id: "pu4", number: 4, name: "Diamond Push-Ups", sets: 3, reps: "8–15", targets: "Triceps, Inner Chest" },
        { id: "pu5", number: 5, name: "Plank Shoulder Taps", sets: 3, reps: "20 taps", targets: "Core, Shoulders" },
      ]
    },
    {
      day_id: "pull",
      exercises: [
        { id: "p1", number: 1, name: "Inverted Rows", sets: 3, reps: "10–15", targets: "Back, Biceps" },
        { id: "p2", number: 2, name: "Towel Rows", sets: 3, reps: "10–15", targets: "Back, Forearms" },
        { id: "p3", number: 3, name: "Superman Hold", sets: 3, reps: "20–30 sec", targets: "Lower Back, Glutes" },
        { id: "p4", number: 4, name: "Reverse Snow Angels", sets: 3, reps: "15–20", targets: "Rear Delts, Upper Back" },
        { id: "p5", number: 5, name: "Towel Curls", sets: 3, reps: "10–12", targets: "Biceps, Forearms" },
      ]
    },
    {
      day_id: "legs",
      exercises: [
        { id: "l1", number: 1, name: "Bodyweight Squats", sets: 4, reps: "15–20", targets: "Quads, Glutes" },
        { id: "l2", number: 2, name: "Reverse Lunges", sets: 3, reps: "10–15 per leg", targets: "Quads, Glutes, Balance" },
        { id: "l3", number: 3, name: "Glute Bridges", sets: 3, reps: "15–20", targets: "Glutes, Hamstrings" },
        { id: "l4", number: 4, name: "Cossack Squats", sets: 3, reps: "8–12 per leg", targets: "Inner Thighs, Mobility" },
        { id: "l5", number: 5, name: "Calf Raises", sets: 3, reps: "15–20", targets: "Calves" },
        { id: "l6", number: 6, name: "Wall Sit", sets: 3, reps: "30–60 sec", targets: "Quads, Isometric" },
      ]
    }
  ];

  for (const group of initialWorkouts) {
    for (const ex of group.exercises) {
      insertExercise.run(ex.id, group.day_id, ex.number, ex.name, ex.sets, ex.reps, ex.targets);
      // Initialize checklist state to all false
      insertChecklist.run(ex.id, JSON.stringify(Array(ex.sets).fill(false)));
    }
  }

  // Seed default settings
  db.prepare("INSERT INTO settings (key, value) VALUES (?, ?)").run("restDuration", "30");
  console.log("Seeding complete.");
}

const app = express();
app.use(express.json());

// API Routes

// 1. Get all workouts (days + exercises)
app.get('/api/workouts', (req, res) => {
  try {
    const days = db.prepare("SELECT * FROM workout_days").all();
    const exercises = db.prepare("SELECT * FROM exercises ORDER BY number ASC").all();

    // Explicit ordering: PUSH first (1), PULL second (2), LEGS third (3)
    const dayOrder = { push: 1, pull: 2, legs: 3 };
    days.sort((a, b) => (dayOrder[a.id] || 99) - (dayOrder[b.id] || 99));

    const result = days.map(day => ({
      ...day,
      exercises: exercises.filter(ex => ex.day_id === day.id)
    }));

    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 2. Get current checklist state
app.get('/api/sets', (req, res) => {
  try {
    const rows = db.prepare("SELECT * FROM checklist_state").all();
    const state = {};
    for (const row of rows) {
      try {
        state[row.exercise_id] = JSON.parse(row.sets_state);
      } catch (err) {
        // Fallback if JSON parse fails
        state[row.exercise_id] = [];
      }
    }
    res.json(state);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 3. Update checklist state for an exercise
app.post('/api/sets', (req, res) => {
  const { exercise_id, sets_state } = req.body;
  if (!exercise_id || !Array.isArray(sets_state)) {
    return res.status(400).json({ error: "Missing exercise_id or sets_state array" });
  }
  try {
    db.prepare("INSERT OR REPLACE INTO checklist_state (exercise_id, sets_state) VALUES (?, ?)")
      .run(exercise_id, JSON.stringify(sets_state));
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 4. Reset checklist state for a specific day's exercises
app.post('/api/sets/reset', (req, res) => {
  const { day_id } = req.body;
  if (!day_id) {
    return res.status(400).json({ error: "Missing day_id" });
  }
  try {
    const exercises = db.prepare("SELECT * FROM exercises WHERE day_id = ?").all(day_id);
    for (const ex of exercises) {
      const resetState = Array(ex.sets).fill(false);
      db.prepare("INSERT OR REPLACE INTO checklist_state (exercise_id, sets_state) VALUES (?, ?)")
        .run(ex.id, JSON.stringify(resetState));
    }
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 5. Add custom exercise
app.post('/api/exercises', (req, res) => {
  const { day_id, name, sets, reps, targets } = req.body;
  if (!day_id || !name || !sets || !reps || !targets) {
    return res.status(400).json({ error: "Missing required exercise fields" });
  }

  try {
    // Generate simple ID
    const id = 'custom_' + Date.now();
    
    // Get max number for order
    const maxNumRow = db.prepare("SELECT MAX(number) as max_num FROM exercises WHERE day_id = ?").get(day_id);
    const number = (maxNumRow.max_num || 0) + 1;

    db.prepare("INSERT INTO exercises (id, day_id, number, name, sets, reps, targets) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .run(id, day_id, number, name, sets, reps, targets);

    // Initialize checklist state
    db.prepare("INSERT INTO checklist_state (exercise_id, sets_state) VALUES (?, ?)")
      .run(id, JSON.stringify(Array(sets).fill(false)));

    res.json({ id, day_id, number, name, sets, reps, targets });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 6. Update exercise
app.put('/api/exercises/:id', (req, res) => {
  const { id } = req.params;
  const { name, sets, reps, targets } = req.body;
  if (!name || !sets || !reps || !targets) {
    return res.status(400).json({ error: "Missing required fields for update" });
  }

  try {
    // Check if the exercise exists
    const ex = db.prepare("SELECT * FROM exercises WHERE id = ?").get(id);
    if (!ex) {
      return res.status(404).json({ error: "Exercise not found" });
    }

    db.prepare("UPDATE exercises SET name = ?, sets = ?, reps = ?, targets = ? WHERE id = ?")
      .run(name, sets, reps, targets, id);

    // If sets count changed, resize the checklist state array
    const stateRow = db.prepare("SELECT sets_state FROM checklist_state WHERE exercise_id = ?").get(id);
    if (stateRow) {
      let currentState = [];
      try {
        currentState = JSON.parse(stateRow.sets_state);
      } catch (e) {}

      let newState;
      if (currentState.length < sets) {
        // pad with false
        newState = [...currentState, ...Array(sets - currentState.length).fill(false)];
      } else if (currentState.length > sets) {
        // truncate
        newState = currentState.slice(0, sets);
      } else {
        newState = currentState;
      }
      db.prepare("UPDATE checklist_state SET sets_state = ? WHERE exercise_id = ?")
        .run(JSON.stringify(newState), id);
    } else {
      db.prepare("INSERT INTO checklist_state (exercise_id, sets_state) VALUES (?, ?)")
        .run(id, JSON.stringify(Array(sets).fill(false)));
    }

    res.json({ id, name, sets, reps, targets });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 7. Delete exercise
app.delete('/api/exercises/:id', (req, res) => {
  const { id } = req.params;
  try {
    db.prepare("DELETE FROM exercises WHERE id = ?").run(id);
    // ON DELETE CASCADE will clean up checklist_state, but we do it manually just in case
    db.prepare("DELETE FROM checklist_state WHERE exercise_id = ?").run(id);
    res.json({ success: true, deleted_id: id });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 8. Log a completed workout
app.post('/api/history', (req, res) => {
  const { day_id, completed_sets, total_sets } = req.body;
  if (!day_id || completed_sets === undefined || total_sets === undefined) {
    return res.status(400).json({ error: "Missing required logging fields" });
  }

  try {
    const date = new Date().toISOString();
    db.prepare("INSERT INTO workout_history (date, day_id, completed_sets, total_sets) VALUES (?, ?, ?, ?)")
      .run(date, day_id, completed_sets, total_sets);
    res.json({ success: true, date });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 9. Get workout history logs
app.get('/api/history', (req, res) => {
  try {
    const logs = db.prepare("SELECT * FROM workout_history ORDER BY date DESC").all();
    res.json(logs);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 10. Get settings
app.get('/api/settings', (req, res) => {
  try {
    const rows = db.prepare("SELECT * FROM settings").all();
    const settings = {};
    for (const row of rows) {
      settings[row.key] = row.value;
    }
    res.json(settings);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 11. Update settings
app.post('/api/settings', (req, res) => {
  const { key, value } = req.body;
  if (!key || value === undefined) {
    return res.status(400).json({ error: "Missing key or value" });
  }
  try {
    db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)")
      .run(key, String(value));
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`Backend server running on http://localhost:${PORT}`);
});
