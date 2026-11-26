# #freeclass 🏫⚡

A lightning-fast, semester-agnostic college room and timetable navigator built with **PostgreSQL**, **Express 5**, and **React 19** in a bold **neo-brutalist** design.

`#freeclass` lets students and faculty instantly discover available classrooms, locate faculty schedules, check charging port availability, and see live, real-time room occupancy and crowd traffic—**with zero login required**.

---

## 🚀 Key Features

- **⚡ Instant Free Room Finder**: Query free rooms at any weekday and time with filterable options (e.g., charging outlets required).
- **🟢 Live No-Login Room Check-ins**:
  - Anonymous browser device identification via `localStorage` device UUIDs.
  - "I'm using this room" one-click check-in with optimistic UI updates and auto-polling every 30s.
  - Live occupancy traffic badges: 🟢 Empty (<25% or 0–1 people), 🟡 A few people (25%–60%), 🔴 Crowded (>60%).
  - Single active check-in guarantee per device across rooms.
- **👨‍🏫 Faculty Rollover Schedule**:
  - Interactive rollover/dropdown menu covering all faculty members.
  - Day-by-day timetable schedule view without requiring manual time inputs.
- **🔌 Unmentioned Charging Rooms**: Special highlighted section for classrooms confirmed to have charging ports even if no classes are formally scheduled there.
- **📊 Real-Time Check-in Traffic Analytics**: Live Stats page powered 100% by student check-in activity—showing active students studying right now, rooms in use, and capacity occupancy bars.
- **🎨 Neo-Brutalism Design**: Vibrant colorful accents, crisp 3px ink borders, hard offset shadows, zero border radii, and 100% mobile-friendly responsive layouts.

---

## 🛠️ Architecture & Tech Stack

- **Frontend**: React 19, Vite, vanilla CSS (neo-brutalist design tokens), Lucide icons.
- **Backend**: Node.js 22, Express 5, `pg` (node-postgres), Zod schema validation.
- **Database**: PostgreSQL 17 (schema `fc`), JSONB staging ETL, custom views, partial unique indexes, row-level locks, and atomic stored procedures.
- **Testing**: Node.js native test runner (`node --test`), high-concurrency race condition testing.

---

## 🧠 Database Design & Concurrency (DBMS Project Details)

### 1. Live Check-in Data Model

```sql
CREATE TABLE fc.checkin (
  checkin_id bigserial PRIMARY KEY,
  device_id text NOT NULL,
  room_id int NOT NULL REFERENCES fc.room(room_id) ON DELETE CASCADE,
  slot_id int NOT NULL REFERENCES fc.time_slot(slot_id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'left', 'expired')),
  UNIQUE (device_id, room_id, slot_id)
);

CREATE INDEX ix_checkin_active ON fc.checkin (room_id, expires_at) WHERE status = 'active';
CREATE INDEX ix_checkin_device ON fc.checkin (device_id, expires_at) WHERE status = 'active';
```

### 2. Transaction Atomicity & Isolation Level Reasoning

All check-in operations execute inside an explicit database transaction (`BEGIN ... COMMIT / ROLLBACK`):
1. **Validation**: Check that the room exists and find the current or next active time slot.
2. **Device Single-Room Constraint**: Check if the device is currently checked into any *other* room. If so, update that check-in to `'left'` in the same transaction.
3. **Insert Check-in**: Insert the new check-in with `expires_at = LEAST(now() + 45 min, slot_end_time)`.
4. **Duplicate Handling**: If the device already has an active check-in for the same room and slot, PostgreSQL's `UNIQUE (device_id, room_id, slot_id)` constraint triggers error code `23505` (`unique_violation`), which the transaction rolls back cleanly and returns `{ status: 'already_checked_in' }` instead of a 500 server crash.

#### Why `READ COMMITTED` Isolation?
- In high-throughput check-in systems, `SERIALIZABLE` isolation can throw serialization anomalies (PostgreSQL SQLSTATE `40001: could not serialize access`) under burst concurrent requests from multiple clients hitting the same room simultaneously, requiring complex client retry logic.
- Under `READ COMMITTED`, PostgreSQL guarantees that each query sees data committed before the query began. By combining row-level updates with the engine-level `UNIQUE (device_id, room_id, slot_id)` constraint:
  - Concurrent inserts for different devices succeed in parallel without blocking.
  - Concurrent inserts from the same device are serialized at the database constraint level, completely eliminating lost updates and duplicate bookings.

### 3. Avoiding Lost Updates: Dynamic Traffic Aggregation

- **No Stored Counters**: We deliberately do **not** use a denormalized counter column (e.g. `rooms.current_traffic`) updated via read-then-write increments/decrements. Stored counters suffer from lost updates during race conditions and require fragile scheduled cleanup cron jobs to decrement when check-ins expire.
- **Computed Query**: Traffic is dynamically aggregated using:
  ```sql
  SELECT
    r.room_id,
    r.room_no,
    COALESCE(r.capacity, 40) AS capacity,
    COUNT(DISTINCT c.device_id) FILTER (
      WHERE c.expires_at > now() AND c.status = 'active'
    ) AS active_count
  FROM fc.room r
  LEFT JOIN fc.checkin c ON c.room_id = r.room_id
  GROUP BY r.room_id, r.room_no, r.capacity;
  ```
  This guarantees that expired check-ins instantly vanish from traffic calculations the exact second `expires_at` passes, with zero background cleanup jobs and 100% mathematical consistency.

### 4. Abuse Protection

- **Device & IP Rate Limiting**: Check-in endpoints enforce rate limiting (max 1 check-in per minute per device ID and IP address).
- **Server-Side Timestamps**: Expiry times (`expires_at`) are computed strictly using PostgreSQL `now()`, preventing client time-spoofing.
- **Input Validation**: `device_id` must conform to strict UUID v4 regex format, and `room_id` is verified against the database.

---

## 🧪 Concurrency Test Suite

The test suite in [`backend/test/checkin.test.js`](backend/test/checkin.test.js) verifies concurrency resilience:
- Fires **25 simultaneous requests** in parallel (20 distinct device IDs + 5 identical device IDs attempting concurrent check-ins into the exact same room).
- Asserts that all 20 unique devices are registered, while all duplicate requests from the same device are safely rejected with `already_checked_in`.
- Verifies that moving to a new room automatically closes previous check-ins in the same transaction.

Run the test suite:
```bash
cd backend
npm test
```

---

## 🐳 Easy Deployment (Docker & Docker Compose)

The entire application (PostgreSQL database + Express backend + React frontend) can be deployed with a single command:

```bash
docker compose up --build
```

- **Web App**: Accessible immediately at `http://localhost:3000`
- **Database**: PostgreSQL 17 container auto-initializes the schema, ETLs the semester timetable data, and creates required roles.

---

## 💻 Local Development Setup

### Prerequisites
- Node.js >= 20.x
- PostgreSQL >= 15.x

### 1. Database Setup
```bash
# In the backend directory, configure .env
cp backend/.env.example backend/.env

# Initialize database schema, roles, and load active semester timetable
cd backend
npm run db:init
```

### 2. Run Backend
```bash
cd backend
npm run dev
# Backend server runs on http://localhost:3000
```

### 3. Run Frontend
```bash
cd frontend
npm install
npm run build
# Frontend dist is automatically served by Express at http://localhost:3000
# Or for live Vite HMR: npm run dev
```

---

## 📄 License
ISC License. Built for university classroom efficiency.
