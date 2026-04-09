<script setup>
import { cn } from '@/lib/utils'

const props = defineProps({
  class: { type: String, default: '' },
  for: { type: String, default: undefined },
})
</script>

<template>
  <label
    :for="props.for"
    :class="
      cn(
        'text-sm font-medium leading-none text-foreground peer-disabled:cursor-not-allowed peer-disabled:opacity-70',
        props.class,
      )
    "
  >
    <slot />
  </label>
</template>
