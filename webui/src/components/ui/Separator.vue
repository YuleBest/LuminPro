<script setup>
import { cn } from '@/lib/utils'

const props = defineProps({
  class: { type: String, default: '' },
  vertical: { type: Boolean, default: false },
})
</script>

<template>
  <div
    :role="'separator'"
    :class="
      cn(
        vertical ? 'inline-flex h-full w-px' : 'flex h-px w-full',
        'bg-border shrink-0',
        props.class,
      )
    "
  />
</template>
