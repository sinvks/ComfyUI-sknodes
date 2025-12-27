<template>
  <div class="sk-vue-helper">
    <button class="sk-refresh-btn" @click="handleReload">
      🔄 刷新预设 (Nodes 2.0)
    </button>
  </div>
</template>

<script>
export default {
  props: ['node', 'reloadApi'],
  methods: {
    async handleReload() {
      const r = await fetch(this.reloadApi, { method: 'POST' });
      const data = await r.json();
      const combo = this.node.widgets.find(w => w.name === "prompt_type");
      if (combo) {
        combo.options.values = data.names || [];
        if (combo.onOptionChange) combo.onOptionChange();
      }
    }
  }
}
</script>

<style scoped>
.sk-vue-helper { padding: 4px; display: flex; justify-content: center; }
.sk-refresh-btn { 
  width: 90%; background: #222; border: 1px solid #444; color: #aaa; 
  font-size: 11px; cursor: pointer; border-radius: 4px; padding: 4px 0;
}
.sk-refresh-btn:hover { background: #333; color: white; }
</style>