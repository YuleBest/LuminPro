<script setup>
import { cn } from '@/lib/utils';

const props = defineProps({
  class: { type: String, default: '' },
});
</script>

<template>
  <div :class="cn('rounded-xl border border-border/40 bg-card text-card-foreground shadow-md', props.class)">
    <slot />
  </div>
</template>
