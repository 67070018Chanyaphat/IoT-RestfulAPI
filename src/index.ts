import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import pg from "pg";

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_SSL === "true" ? { rejectUnauthorized: false } : undefined,
});

async function initDb() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS students (
        id           SERIAL PRIMARY KEY,
        first_name   TEXT NOT NULL,
        last_name    TEXT NOT NULL,
        student_code TEXT NOT NULL UNIQUE,
        birth_date   DATE NOT NULL,
        gender       TEXT NOT NULL CHECK (gender IN ('male', 'female', 'other')),
        created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);
    console.log("Database initialized successfully");
  } catch (err) {
    console.error("Failed to initialize database:", err);
  }
}

initDb();

const COLUMNS = `id, first_name, last_name, student_code,
  to_char(birth_date, 'YYYY-MM-DD') AS birth_date, gender, created_at`;

const GENDERS = ["male", "female", "other"];

function validate(body: any) {
  if (!body || typeof body !== "object") return { error: "Invalid JSON body" };
  const { first_name, last_name, student_code, birth_date, gender } = body;

  for (const [key, val] of Object.entries({ first_name, last_name, student_code })) {
    if (typeof val !== "string" || val.trim() === "") {
      return { error: `${key} is required and must be a non-empty string` };
    }
  }
  if (
    typeof birth_date !== "string" ||
    !/^\d{4}-\d{2}-\d{2}$/.test(birth_date) ||
    Number.isNaN(Date.parse(birth_date))
  ) {
    return { error: "birth_date is required, format YYYY-MM-DD" };
  }
  if (!GENDERS.includes(gender)) {
    return { error: `gender must be one of: ${GENDERS.join(", ")}` };
  }
  return {
    data: {
      first_name: first_name.trim(),
      last_name: last_name.trim(),
      student_code: student_code.trim(),
      birth_date,
      gender,
    },
  };
}

function parseId(raw: string): number | null {
  const id = Number(raw);
  return Number.isInteger(id) && id > 0 ? id : null;
}

const app = new Hono();
app.use("*", cors());

const students = new Hono();

// READ ทั้งหมด
students.get("/", async (c) => {
  const { rows } = await pool.query(`SELECT ${COLUMNS} FROM students ORDER BY id`);
  return c.json(rows);
});

// READ รายคน
students.get("/:id", async (c) => {
  const id = parseId(c.req.param("id"));
  if (!id) return c.json({ error: "Invalid id" }, 400);

  const { rows } = await pool.query(`SELECT ${COLUMNS} FROM students WHERE id = $1`, [id]);
  if (rows.length === 0) return c.json({ error: "Student not found" }, 404);
  return c.json(rows[0]);
});

// CREATE
students.post("/", async (c) => {
  const body = await c.req.json().catch(() => null);
  const { data, error } = validate(body);
  if (!data) return c.json({ error }, 400);

  try {
    const { rows } = await pool.query(
      `INSERT INTO students (first_name, last_name, student_code, birth_date, gender)
       VALUES ($1, $2, $3, $4, $5) RETURNING ${COLUMNS}`,
      [data.first_name, data.last_name, data.student_code, data.birth_date, data.gender],
    );
    return c.json(rows[0], 201);
  } catch (e: any) {
    if (e.code === "23505") return c.json({ error: "student_code already exists" }, 409);
    throw e;
  }
});

// UPDATE 
students.put("/:id", async (c) => {
  const id = parseId(c.req.param("id"));
  if (!id) return c.json({ error: "Invalid id" }, 400);

  const body = await c.req.json().catch(() => null);
  const { data, error } = validate(body);
  if (!data) return c.json({ error }, 400);

  try {
    const { rows } = await pool.query(
      `UPDATE students
       SET first_name = $1, last_name = $2, student_code = $3, birth_date = $4, gender = $5
       WHERE id = $6 RETURNING ${COLUMNS}`,
      [data.first_name, data.last_name, data.student_code, data.birth_date, data.gender, id],
    );
    if (rows.length === 0) return c.json({ error: "Student not found" }, 404);
    return c.json(rows[0]);
  } catch (e: any) {
    if (e.code === "23505") return c.json({ error: "student_code already exists" }, 409);
    throw e;
  }
});

// DELETE
students.delete("/:id", async (c) => {
  const id = parseId(c.req.param("id"));
  if (!id) return c.json({ error: "Invalid id" }, 400);

  const { rowCount } = await pool.query("DELETE FROM students WHERE id = $1", [id]);
  if (rowCount === 0) return c.json({ error: "Student not found" }, 404);
  return c.body(null, 204);
});


app.get("/", (c) => c.text("Student API is running"));
app.route("/api/v1/students", students); 

app.notFound((c) => c.json({ error: "Not found" }, 404));
app.onError((err, c) => {
  console.error(err);
  return c.json({ error: "Internal server error" }, 500);
});
const port = Number(process.env.PORT) || 3000;

serve(
  {
    fetch: app.fetch,
    port: port,
    hostname: "0.0.0.0", 
  },
  (info) => {
    console.log(`Server is running on port ${info.port}`);
  }
);