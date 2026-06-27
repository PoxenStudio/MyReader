import { drizzle } from "drizzle-orm/sqlite-proxy";
import { createDrizzleProxy } from "tauri-plugin-turso-api";
import * as schema from "./schema";

export type { Todo, NewTodo, TodoUpdate } from "./schema";
export { schema };

export function createDb(dbPath: string) {
  return drizzle<typeof schema>(createDrizzleProxy(dbPath), { schema });
}
