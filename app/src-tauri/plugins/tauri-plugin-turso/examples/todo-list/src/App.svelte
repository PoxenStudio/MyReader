<script lang="ts">
  import { onMount } from "svelte";
  import { Toaster } from "svelte-sonner";
  import { getConfig } from "tauri-plugin-turso-api";
  import TodoList from "$lib/TodoList.svelte";
  import Card from "$lib/components/Card.svelte";
  import CardHeader from "$lib/components/CardHeader.svelte";
  import CardTitle from "$lib/components/CardTitle.svelte";
  import CardDescription from "$lib/components/CardDescription.svelte";
  import CardContent from "$lib/components/CardContent.svelte";
  import Button from "$lib/components/Button.svelte";
  import Input from "$lib/components/Input.svelte";

  const STORAGE_SYNC_URL = "turso-demo-sync-url";
  const STORAGE_AUTH_TOKEN = "turso-demo-auth-token";

  let encrypted = $state(false);
  let configLoaded = $state(false);

  // Use different db filenames when encryption is enabled to avoid
  // "file is not a database" errors from opening an unencrypted db
  // with an encryption key (or vice versa).
  let localDbFile = $derived(encrypted ? "todos.enc.db" : "todos.db");
  let tursoDbFile = $derived(encrypted ? "todos-turso.enc.db" : "todos-turso.db");

  onMount(async () => {
    const config = await getConfig();
    encrypted = config.encrypted;
    configLoaded = true;
  });

  // Read saved settings synchronously — localStorage is available at module init
  let appliedSyncUrl = $state(localStorage.getItem(STORAGE_SYNC_URL) ?? "");
  let appliedAuthToken = $state(localStorage.getItem(STORAGE_AUTH_TOKEN) ?? "");

  // Form inputs (editable before connecting)
  let syncUrlInput = $state(localStorage.getItem(STORAGE_SYNC_URL) ?? "");
  let authTokenInput = $state(localStorage.getItem(STORAGE_AUTH_TOKEN) ?? "");
  let connectError = $state("");

  function handleConnect(e: Event) {
    e.preventDefault();
    if (!syncUrlInput.trim()) {
      connectError = "Remote URL is required.";
      return;
    }
    connectError = "";
    appliedSyncUrl = syncUrlInput.trim();
    appliedAuthToken = authTokenInput.trim();
    localStorage.setItem(STORAGE_SYNC_URL, appliedSyncUrl);
    localStorage.setItem(STORAGE_AUTH_TOKEN, appliedAuthToken);
  }

  function handleDisconnect() {
    appliedSyncUrl = "";
    appliedAuthToken = "";
    syncUrlInput = "";
    authTokenInput = "";
    localStorage.removeItem(STORAGE_SYNC_URL);
    localStorage.removeItem(STORAGE_AUTH_TOKEN);
  }
</script>

<Toaster richColors={true} theme="dark" />
<main class="min-h-screen bg-background p-4 sm:p-6">
  <div class="mx-auto max-w-5xl">
    <div class="mb-6 text-center">
      <h1 class="text-2xl font-bold">tauri-plugin-turso demo</h1>
      <p class="mt-1 text-sm text-muted-foreground">
        Local SQLite on the left · Turso embedded replica on the right
      </p>
    </div>

    <div class="grid grid-cols-1 gap-4 md:grid-cols-2">
      {#if !configLoaded}
        <div class="col-span-2 flex items-center justify-center py-16 text-muted-foreground">
          <span class="text-sm">Loading...</span>
        </div>
      {:else}
      <!-- Left: Local DB -->
      <TodoList dbFile={localDbFile} position="bottom-left" />

      <!-- Right: Turso or connect form -->
      {#if appliedSyncUrl}
        <TodoList
          dbFile={tursoDbFile}
          syncUrl={appliedSyncUrl}
          authToken={appliedAuthToken}
          onDisconnect={handleDisconnect}
          position="bottom-right"
        />
      {:else}
        <Card class="border-border/50 shadow-xl">
          <CardHeader class="space-y-2">
            <CardTitle class="flex items-center gap-2 text-lg">
              <span>☁️ Turso</span>
            </CardTitle>
            <CardDescription>
              Connect to a Turso database to test embedded replica sync
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onsubmit={handleConnect} class="space-y-3">
              <div class="space-y-1">
                <label class="text-xs text-muted-foreground" for="sync-url"
                  >Remote URL</label
                >
                <Input
                  id="sync-url"
                  type="text"
                  bind:value={syncUrlInput}
                  placeholder="turso://mydb-org.turso.io"
                  class="font-mono text-xs"
                />
              </div>
              <div class="space-y-1">
                <label class="text-xs text-muted-foreground" for="auth-token"
                  >Auth Token</label
                >
                <Input
                  id="auth-token"
                  type="password"
                  bind:value={authTokenInput}
                  placeholder="your-turso-auth-token"
                  class="font-mono text-xs"
                />
              </div>
              {#if connectError}
                <p class="text-xs text-destructive">{connectError}</p>
              {/if}
              <Button type="submit" class="w-full">Connect</Button>
            </form>

            <div
              class="mt-6 space-y-2 rounded-md border border-border/50 bg-muted/30 p-3 text-xs text-muted-foreground"
            >
              <p class="font-medium">How to get your credentials:</p>
              <ol class="ml-3 list-decimal space-y-1">
                <li>
                  Create a database at <span class="font-mono">turso.tech</span>
                </li>
                <li>
                  <span class="font-mono"
                    >turso db show --url &lt;db-name&gt;</span
                  >
                </li>
                <li>
                  <span class="font-mono"
                    >turso db tokens create &lt;db-name&gt;</span
                  >
                </li>
              </ol>
            </div>
          </CardContent>
        </Card>
      {/if}
      {/if}
    </div>
  </div>
</main>
