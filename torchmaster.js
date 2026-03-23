// Register the module
Hooks.once("init", () => {
  console.log("Torchmaster | Initialised");
});

// Helper — check if current user is DM or has co-DM flag
function hasDmPrivileges() {
  return game.user.isGM || game.user.getFlag("world", "isDMCo") === true;
}

// Add the light config button to item sheets
Hooks.on("renderItemSheet", (app, html, data) => {
  if (!hasDmPrivileges()) return;

  // Only add to physical items that could be light sources
  const item = app.item;

  // Insert button in the item sheet header
  const header = html.find(".window-header .window-title");
  const button = $(`
    <a class="torchmaster-config" title="Configure Light Source" style="
      margin-left: 8px;
      cursor: pointer;
      color: #a2642a;
      font-size: 0.9em;
    ">
      🔥 Light Config
    </a>
  `);

  header.after(button);

  button.click(() => openLightConfig(item));
});

// Open the light config dialog
async function openLightConfig(item) {
  // Get existing saved config or defaults
  const saved = item.getFlag("torchmaster", "lightConfig") ?? {
    bright: 20,
    dim: 40,
    color: "#a2642a",
    animation: "torch",
    animationSpeed: 5,
    animationIntensity: 5
  };

  // Render the template
  const content = await renderTemplate(
    "modules/torchmaster/templates/light-config.html",
    saved
  );

  new Dialog({
    title: `🔥 Light Config — ${item.name}`,
    content,
    buttons: {
      save: {
        label: "Save",
        callback: async (html) => {
          const form = html.find("form")[0];
          const config = {
            bright: parseInt(form.bright.value),
            dim: parseInt(form.dim.value),
            color: form.color.value,
            animation: form.animation.value,
            animationSpeed: parseInt(form.animationSpeed.value),
            animationIntensity: parseInt(form.animationIntensity.value)
          };

          // Save config to the item as a flag
          await item.setFlag("torchmaster", "lightConfig", config);
          ui.notifications.info(`Torchmaster | Light config saved for ${item.name}`);
        }
      },
      cancel: {
        label: "Cancel"
      }
    },
    default: "save"
  }).render(true);
}

// Override item use to apply light config
Hooks.on("dnd5e.useItem", async (item, config, options) => {
  if (!item) return;

  const lightConfig = item.getFlag("torchmaster", "lightConfig");
  if (!lightConfig) return;

  // Find the token for this actor
  const actor = item.actor;
  if (!actor) return;

  const token = canvas.tokens.placeables.find(t => t.actor?.id === actor.id);
  if (!token) return;

  const hasLight = token.document.light.bright > 0;

  // Toggle light
  await token.document.update({
    light: {
      bright: hasLight ? 0 : lightConfig.bright,
      dim: hasLight ? 0 : lightConfig.dim,
      color: lightConfig.color,
      animation: {
        type: hasLight ? "none" : lightConfig.animation,
        speed: lightConfig.animationSpeed,
        intensity: lightConfig.animationIntensity
      }
    }
  });

  // Post chat message
  await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor }),
    flags: {
      world: {
        torchToggle: true,
        tokenId: token.id
      }
    },
    content: `
      <div style="
        background: #1a1a2e;
        border: 1px solid #a2642a;
        border-radius: 8px;
        padding: 10px;
        font-family: Georgia, serif;
        color: #f0e6d3;
      ">
        <div style="
          display: flex;
          align-items: center;
          gap: 10px;
          margin-bottom: 8px;
          border-bottom: 1px solid #a2642a;
          padding-bottom: 8px;
        ">
          <img src="${item.img}" width="36" height="36" style="border-radius: 4px; border: 1px solid #a2642a"/>
          <strong style="font-size: 1.1em;">🔥 ${item.name}</strong>
        </div>
        <p style="margin: 4px 0; font-size: 0.9em;">
          ${hasLight ? "🌑 The light is extinguished." : "🔥 The light flickers to life."}
        </p>
        <p style="margin: 4px 0; font-size: 0.85em; color: #c8a97e;">
          Bright: <strong>${lightConfig.bright}ft</strong> &nbsp;|&nbsp; Dim: <strong>${lightConfig.dim}ft</strong>
        </p>
        <div style="display: flex; gap: 8px; margin-top: 10px;">
          <button class="torch-btn" data-token-id="${token.id}" data-action="light"
            style="flex:1; background:#2a2a3e; color:#f0e6d3; border:1px solid #a2642a; border-radius:4px; padding:4px 8px; cursor:pointer; font-family:Georgia,serif;">
            🔥 Light
          </button>
          <button class="torch-btn" data-token-id="${token.id}" data-action="extinguish"
            style="flex:1; background:#2a2a3e; color:#f0e6d3; border:1px solid #a2642a; border-radius:4px; padding:4px 8px; cursor:pointer; font-family:Georgia,serif;">
            🌑 Extinguish
          </button>
        </div>
      </div>
    `
  });
});

// Handle chat button clicks
Hooks.on("renderChatMessage", (message, html) => {
  if (!message.flags?.world?.torchToggle) return;

  html.find(".torch-btn").click(async (event) => {
    const action = event.currentTarget.dataset.action;
    const tokenId = event.currentTarget.dataset.tokenId;
    const t = canvas.tokens.get(tokenId);
    if (!t) return ui.notifications.warn("Token not found!");

    const isLighting = action === "light";
    await t.document.update({
      light: {
        bright: isLighting ? 20 : 0,
        dim: isLighting ? 40 : 0,
        color: "#a2642a",
        animation: { type: isLighting ? "torch" : "none" }
      }
    });
    ui.notifications.info(isLighting ? "Light on!" : "Light off!");
  });
});