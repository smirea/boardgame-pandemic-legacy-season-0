<script lang="ts">
  import { QueryClient, QueryClientProvider } from "@tanstack/svelte-query";
  import "./layout.css";

  let { children } = $props();
  const browser = typeof window !== "undefined";

  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        enabled: browser,
      },
    },
  });

  $effect(() => {
    if (!browser) return;

    const syncWindowActivity = () => {
      const inactive = document.visibilityState !== "visible" || !document.hasFocus();
      document.documentElement.toggleAttribute("data-window-inactive", inactive);
    };

    syncWindowActivity();
    window.addEventListener("focus", syncWindowActivity);
    window.addEventListener("blur", syncWindowActivity);
    document.addEventListener("visibilitychange", syncWindowActivity);

    return () => {
      window.removeEventListener("focus", syncWindowActivity);
      window.removeEventListener("blur", syncWindowActivity);
      document.removeEventListener("visibilitychange", syncWindowActivity);
    };
  });
</script>

<QueryClientProvider client={queryClient}>
  {@render children()}
</QueryClientProvider>
