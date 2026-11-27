<script lang="ts">
  import type { StatusResponse } from "@repo/shared";
  import { createQuery } from "@tanstack/svelte-query";

  const status = createQuery(() => ({
    queryKey: ["status"],
    queryFn: fetchStatus,
  }));

  async function fetchStatus(): Promise<StatusResponse> {
    const response = await fetch("/api/status");
    if (!response.ok) throw new Error(await response.text());
    return response.json();
  }
</script>

<svelte:head>
  <title>Pandemic Legacy: Season 0</title>
</svelte:head>

<main class="desk">
  <section class="dossier">
    <header class="dossier-head">
      <p class="classification">FIELD MANUAL N4245.3 // 1962</p>
      <span class="stamp">TOP SECRET</span>
    </header>

    <h1>PANDEMIC LEGACY: SEASON 0</h1>
    <p class="lede">
      Situation room shell is wired with semantic design tokens, self-hosted typography, and the
      Bun API server.
    </p>

    <div class="actions">
      <button type="button" class="primary" onclick={() => void status.refetch()}>
        Check Comms
      </button>
    </div>

    <div class="telemetry">
      <p class="label">STATION LINK</p>
      {#if status.isError}
        <p class="alert">{status.error.message}</p>
      {:else if status.isPending}
        <p class="muted">Checking station...</p>
      {:else if status.data}
        <p class="online">Station online.</p>
        <p class="timestamp">{status.data.now}</p>
      {/if}
    </div>
  </section>
</main>

<style>
  .desk {
    min-height: 100vh;
    display: grid;
    place-items: center;
    padding: 2rem;
    background: var(--surface-desk);
    color: var(--ink-primary);
  }

  .dossier {
    display: grid;
    gap: 1.5rem;
    width: min(100%, 40rem);
    padding: 2rem;
    background: var(--surface-manila);
    color: var(--ink-paper);
    border: 1px solid var(--border-paper);
    box-shadow: var(--shadow-document);
  }

  .dossier-head {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 1rem;
    border-bottom: 1px solid var(--border-paper);
    padding-bottom: 0.75rem;
  }

  .classification {
    margin: 0;
    font-family: var(--font-typewriter);
    font-size: 0.8rem;
    letter-spacing: 0.12em;
    color: var(--ink-paper-muted);
  }

  .stamp {
    font-family: var(--font-typewriter);
    font-size: 0.75rem;
    font-weight: 700;
    letter-spacing: 0.1em;
    color: var(--signal-espionage-deep);
    border: 2px solid var(--signal-espionage-deep);
    padding: 0.15rem 0.45rem;
    transform: rotate(-3deg);
  }

  h1 {
    margin: 0;
    font-family: var(--font-display);
    font-size: clamp(2.4rem, 6vw, 3.6rem);
    font-weight: 800;
    letter-spacing: 0.03em;
    line-height: 0.95;
  }

  .lede {
    margin: 0;
    font-family: var(--font-typewriter);
    font-size: 0.95rem;
    line-height: 1.6;
    color: var(--ink-paper-muted);
  }

  .actions {
    display: flex;
    gap: 0.75rem;
  }

  button.primary {
    border: 1px solid var(--ink-paper);
    background: var(--ink-paper);
    color: var(--surface-manila);
    padding: 0.55rem 1.1rem;
    font-weight: 600;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    cursor: pointer;
    transition: opacity var(--duration-fast) var(--ease-mechanical);
  }

  button.primary:hover {
    opacity: 0.88;
  }

  .telemetry {
    border-top: 1px dashed var(--border-paper);
    padding-top: 1rem;
    display: grid;
    gap: 0.25rem;
  }

  .label {
    margin: 0;
    font-size: 0.75rem;
    font-weight: 700;
    letter-spacing: 0.1em;
    color: var(--ink-paper-muted);
  }

  .online,
  .muted,
  .alert,
  .timestamp {
    margin: 0;
    font-family: var(--font-typewriter);
    font-size: 0.875rem;
    font-variant-numeric: tabular-nums;
  }

  .muted,
  .timestamp {
    color: var(--ink-paper-muted);
  }

  .alert {
    color: var(--signal-espionage-deep);
  }
</style>
