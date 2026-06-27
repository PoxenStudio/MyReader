<script lang="ts">
  import { cn } from "$lib/utils";
  import type { HTMLAttributes } from "svelte/elements";

  interface Props extends HTMLAttributes<HTMLDivElement> {
    variant?: "default" | "destructive" | "success" | "warning";
    class?: string;
  }

  let {
    variant = "default",
    class: className,
    children,
    ...rest
  }: Props = $props();

  const variants = {
    default: "bg-secondary text-secondary-foreground",
    destructive: "bg-destructive/15 text-destructive border border-destructive/20",
    success: "bg-success/15 text-success border border-success/20",
    warning: "bg-warning/15 text-warning border border-warning/20",
  };
</script>

<div
  class={cn(
    "rounded-lg px-4 py-3 text-sm",
    variants[variant],
    className
  )}
  {...rest}
>
  {@render children?.()}
</div>
