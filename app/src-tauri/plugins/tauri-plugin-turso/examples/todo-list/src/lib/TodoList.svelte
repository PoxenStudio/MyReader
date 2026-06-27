<script lang="ts">
  import { onMount } from "svelte";
  import { toast } from "svelte-sonner";
  import { resolve } from "@tauri-apps/api/path";
  import { Database, migrate } from "tauri-plugin-turso-api";
  import type { LoadOptions } from "tauri-plugin-turso-api";
  import { desc, eq } from "drizzle-orm";
  import { schema, createDb, type Todo, type TodoUpdate } from "$lib/db";

  import Button from "$lib/components/Button.svelte";
  import Input from "$lib/components/Input.svelte";
  import Card from "$lib/components/Card.svelte";
  import CardHeader from "$lib/components/CardHeader.svelte";
  import CardTitle from "$lib/components/CardTitle.svelte";
  import CardDescription from "$lib/components/CardDescription.svelte";
  import CardContent from "$lib/components/CardContent.svelte";
  import Checkbox from "$lib/components/Checkbox.svelte";
  import Badge from "$lib/components/Badge.svelte";
  import Alert from "$lib/components/Alert.svelte";

  const migrations = import.meta.glob<string>("../../drizzle/*.sql", {
    eager: true,
    query: "?raw",
    import: "default",
  });

  type ToastPosition =
    | "top-left"
    | "top-right"
    | "bottom-left"
    | "bottom-right"
    | "top-center"
    | "bottom-center";

  let {
    dbFile,
    syncUrl = "",
    authToken = "",
    position = "bottom-left" as ToastPosition,
    onDisconnect,
  }: {
    dbFile: string;
    syncUrl?: string;
    authToken?: string;
    position?: ToastPosition;
    onDisconnect?: () => void;
  } = $props();

  const dbPath = $derived(`sqlite:${dbFile}`);
  const isTurso = $derived(!!syncUrl);

  let todos = $state<Todo[]>([]);
  let newTodo = $state("");
  let loading = $state(true);
  let error = $state("");
  let dbAbsPath = $state("");
  let syncing = $state(false);
  let resetting = $state(false);

  type DrizzleDb = ReturnType<typeof createDb>;
  let db: DrizzleDb | null = null;
  let dbInstance = $state<Database | null>(null);

  onMount(async () => {
    try {
      dbAbsPath = await resolve(dbFile);

      const options: LoadOptions = { path: dbPath };
      if (syncUrl) options.syncUrl = syncUrl;
      if (authToken) options.authToken = authToken;

      dbInstance = await Database.load(options);
      db = createDb(dbPath);
      await migrate(dbPath, migrations);
      await loadTodos();
      loading = false;
      toast.success("Database ready", {
        description: isTurso ? "Connected to Turso" : "Local SQLite loaded",
        position,
      });
    } catch (e) {
      error = `${e}`;
      loading = false;
      console.error(e);
      toast.error("Failed to load database", { description: `${e}`, position });
    }
  });

  // Drop all app tables + migration tracking, then re-run migrations from scratch.
  // Useful when the remote DB was manually modified (tables deleted without
  // clearing __drizzle_migrations).
  async function resetAndMigrate() {
    if (!dbInstance) return;
    resetting = true;
    error = "";
    const toastId = toast.loading("Resetting database…", { position });
    try {
      await dbInstance.execute("DROP TABLE IF EXISTS todos");
      await dbInstance.execute("DROP TABLE IF EXISTS __drizzle_migrations");
      await migrate(dbPath, migrations);
      db = createDb(dbPath);
      await loadTodos();
      toast.success("Database reset", {
        id: toastId,
        description: "Tables dropped and migrations re-applied",
        position,
      });
    } catch (e) {
      error = `Reset failed: ${e}`;
      console.error(e);
      toast.error("Reset failed", { id: toastId, description: `${e}`, position });
    } finally {
      resetting = false;
    }
  }

  async function loadTodos() {
    if (!db) return;
    todos = await db.query.todos.findMany({
      orderBy: desc(schema.todos.createdAt),
    });
  }

  async function addTodo() {
    if (!db || !newTodo.trim()) return;
    const title = newTodo.trim();
    newTodo = "";
    try {
      await db.insert(schema.todos).values({ title });
      await loadTodos();
      toast.success("Todo added", { description: title, position });
    } catch (e) {
      toast.error("Failed to add todo", { description: `${e}`, position });
    }
  }

  async function toggleTodo(todo: Todo) {
    if (!db) return;
    try {
      await db
        .update(schema.todos)
        .set({ completed: todo.completed ? 0 : 1 } as TodoUpdate)
        .where(eq(schema.todos.id, todo.id));
      await loadTodos();
      if (!todo.completed) {
        toast.success("Marked as done", { description: todo.title, position });
      } else {
        toast("Marked as active", { description: todo.title, position });
      }
    } catch (e) {
      toast.error("Failed to update todo", { description: `${e}`, position });
    }
  }

  async function deleteTodo(id: number) {
    if (!db) return;
    const deleted = todos.find((t) => t.id === id);
    try {
      await db.delete(schema.todos).where(eq(schema.todos.id, id));
      await loadTodos();
      toast.success("Todo deleted", { description: deleted?.title, position });
    } catch (e) {
      toast.error("Failed to delete todo", { description: `${e}`, position });
    }
  }

  async function syncNow() {
    if (!dbInstance) return;
    syncing = true;
    const toastId = toast.loading("Syncing from Turso…", { position });
    try {
      await dbInstance.sync();
      await loadTodos();
      toast.success("Sync complete", {
        id: toastId,
        description: "Synced at " + new Date().toLocaleTimeString(),
        position,
      });
    } catch (e) {
      console.error(e);
      toast.error("Sync failed", { id: toastId, description: `${e}`, position });
    } finally {
      syncing = false;
    }
  }

  function handleSubmit(e: Event) {
    e.preventDefault();
    addTodo();
  }

  let completedCount = $derived(todos.filter((t) => t.completed).length);
  let totalCount = $derived(todos.length);
</script>

<Card class="flex h-full flex-col border-border/50 shadow-xl">
  <CardHeader class="space-y-2">
    <div class="flex items-center justify-between">
      <CardTitle class="flex items-center gap-2 text-lg">
        {#if isTurso}
          <span>☁️ Turso</span>
          <Badge class="border-blue-500/30 bg-blue-500/10 text-blue-500 text-xs">Remote</Badge>
        {:else}
          <span>💾 Local</span>
          <Badge variant="secondary" class="text-xs">SQLite</Badge>
        {/if}
      </CardTitle>
      {#if isTurso && onDisconnect}
        <button
          type="button"
          onclick={onDisconnect}
          class="text-xs text-muted-foreground hover:text-destructive transition-colors"
          title="Disconnect"
        >
          <svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      {/if}
    </div>
    <CardDescription class="break-all font-mono text-xs">
      {dbAbsPath || dbFile}
    </CardDescription>
  </CardHeader>

  <CardContent class="flex flex-1 flex-col space-y-4">
    {#if loading}
      <div class="flex flex-1 items-center justify-center py-8">
        <div class="flex items-center gap-3 text-muted-foreground">
          <svg class="h-4 w-4 animate-spin" fill="none" viewBox="0 0 24 24">
            <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
            <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
          </svg>
          <span class="text-sm">Loading...</span>
        </div>
      </div>
    {:else if error}
      <Alert variant="destructive">
        <div class="flex items-start gap-2">
          <svg class="mt-0.5 h-4 w-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <div class="flex-1">
            <span class="text-xs">{error}</span>
            {#if error.includes("no such table")}
              <p class="mt-1 text-xs opacity-80">The remote DB may have stale migration records. Use "Reset DB" to drop all tables and re-run migrations.</p>
            {/if}
          </div>
        </div>
      </Alert>
    {:else}
      <form onsubmit={handleSubmit} class="flex gap-2">
        <Input
          type="text"
          bind:value={newTodo}
          placeholder="What needs to be done?"
          class="flex-1 h-8 text-sm"
        />
        <Button type="submit" disabled={!newTodo.trim()} class="h-8 shrink-0 px-3 text-sm">
          Add
        </Button>
      </form>

      {#if todos.length > 0}
        <div class="flex items-center justify-between text-xs text-muted-foreground">
          <Badge variant="secondary" class="bg-secondary/50 text-xs">{totalCount} total</Badge>
          <Badge variant="secondary" class="bg-success/10 text-success border-success/20 text-xs">
            {completedCount} done
          </Badge>
        </div>

        <ul class="flex-1 space-y-1.5 overflow-y-auto">
          {#each todos as todo (todo.id)}
            <li class="group flex items-center gap-2 rounded-md border border-border/50 bg-secondary/20 px-3 py-2 transition-all hover:bg-secondary/30 {todo.completed ? 'opacity-60' : ''}">
              <Checkbox
                checked={Boolean(todo.completed)}
                onchange={() => toggleTodo(todo)}
                class="shrink-0"
              />
              <span class="flex-1 text-sm {todo.completed ? 'line-through text-muted-foreground' : ''}">
                {todo.title}
              </span>
              <button
                type="button"
                onclick={() => deleteTodo(todo.id)}
                aria-label="Delete todo"
                class="h-6 w-6 opacity-0 group-hover:opacity-100 flex items-center justify-center rounded transition-opacity text-muted-foreground hover:text-destructive"
              >
                <svg class="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                </svg>
              </button>
            </li>
          {/each}
        </ul>
      {:else}
        <div class="flex flex-1 flex-col items-center justify-center py-8 text-center">
          <div class="mb-3 rounded-full bg-muted p-3">
            <svg class="h-6 w-6 text-muted-foreground" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
            </svg>
          </div>
          <p class="text-sm text-muted-foreground">No todos yet.</p>
        </div>
      {/if}
    {/if}

    {#if !loading}
      <div class="border-t border-border/50 pt-3 space-y-2">
        {#if isTurso && !error}
          <Button
            type="button"
            variant="outline"
            onclick={syncNow}
            disabled={syncing}
            class="h-7 w-full text-xs"
          >
            {#if syncing}
              <svg class="mr-1.5 h-3 w-3 animate-spin" fill="none" viewBox="0 0 24 24">
                <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
              </svg>
              Syncing...
            {:else}
              <svg class="mr-1.5 h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
              Sync from Turso
            {/if}
          </Button>
        {/if}

        {#if dbInstance}
          <Button
            type="button"
            variant="ghost"
            onclick={resetAndMigrate}
            disabled={resetting}
            class="h-7 w-full text-xs text-muted-foreground/50 hover:text-destructive hover:bg-destructive/10"
          >
            {resetting ? "Resetting…" : "Reset DB"}
          </Button>
        {/if}
      </div>
    {/if}
  </CardContent>
</Card>
