<script setup>
defineProps({
  messages: { type: Array, default: () => [] },
})
</script>

<template>
  <div class="snackbar-host">
    <TransitionGroup name="snackbar">
      <div v-for="message in messages" :key="message.id" class="snackbar" role="status">
        {{ message.text }}
      </div>
    </TransitionGroup>
  </div>
</template>
