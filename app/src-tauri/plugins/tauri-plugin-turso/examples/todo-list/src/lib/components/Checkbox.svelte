<script lang="ts">
  import { cn } from "$lib/utils";
  import type { HTMLInputAttributes } from "svelte/elements";

  interface Props extends HTMLInputAttributes {
    class?: string;
    checked?: boolean;
  }

  let {
    class: className,
    checked = $bindable(false),
    onchange,
    onfocus,
    onblur,
    disabled,
    ...rest
  }: Props = $props();
</script>

<input
  type="checkbox"
  class={cn(
    "peer h-4 w-4 shrink-0 rounded-sm border border-primary ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 accent-primary",
    className
  )}
  bind:checked
  {onchange}
  {onfocus}
  {onblur}
  {disabled}
  {...rest}
/>
