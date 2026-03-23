// Register the module
Hooks.once("init", () => {
  console.log("Torchmaster | Initialised");
});

// Helper — check if current user is DM or has co-DM flag
function hasDmPrivileges() {
  return game.user.isGM || game.user.getFlag("world", "isDMCo") === true;
}

// Add button to both default and Tidy5e item sheets
function addLightConfigButton(app, html) {
  if (!hasDmPrivileges()) return;
  const $html = html instanceof jQuery ? html : $(html.element ?? html);
  if ($html.find(".torchmaster-config").length > 0) return;

  const menu = $html.find("menu.controls-dropdown");
  if (!menu.length) return;

  const menuItem = $(`
    <li class="header-control">
      <button type="button" class="control torchmaster-config">
        <i class="control-icon fa-fw fa-solid fa-fire"></i>
        <span class="control-label">Light Config</span>
      </button>
    </li>
  `);

  menu.append(menuItem);
  menuItem.find("button").click(() => openLightConfig(app.item ?? app.document));
}

Hooks.on("renderItemSheet", addLightConfigButton);
Hooks.on("renderTidy5eItemSheetQuadrone", addLightConfigButton);

// Open the light config dialog
async function openLightConfig(item) {
  const saved = item.getFlag("torchmaster", "lightConfig") ?? {
    bright: 20,
    dim: 40,
    color: "#a2642a",
    animation: "torch",
    animationSpeed: 5,
    animationIntensity: 5
  };

  const content = await foundry.applications.handlebars.renderTemplate(
    "modules/torchmaster/templates/light-config.html",
    saved
  );

  const { DialogV2 } = foundry.applications.api;
  await DialogV2.prompt({
    window: { title: `🔥 Light Config — ${item.name}` },
    content,
    ok: {
      label: "Save",
      callback: async (event, button) => {
        const form = button.form
          ?? button.closest("form")
          ?? button.closest(".window-content").querySelector("form");

        const config = {
          bright: parseInt(form.bright.value),
          dim: parseInt(form.dim.value),
          color: form.color.value,
          animation: form.animation.value,
          animationSpeed: parseInt(form.animationSpeed.value),
          animationIntensity: parseInt(form.animationIntensity.value)
        };

        await item.setFlag("torchmaster", "lightConfig", config);

        // Check if Light Torch activity already exists
        const activities = item.system.activities;
        const hasActivity = activities?.some(a => a.name === "Light Torch")
          ?? [...(activities?.values() ?? [])].some(a => a.name === "Light Torch");

        if (!hasActivity) {
          try {
            const newId = foundry.utils.randomID();
            const update = {};
            update[`system.activities.${newId}`] = {
              type: "utility",
              name: "Light Torch",
              img: item.img ?? "icons/sundries/lights/torch-brown-lit.webp",
              activation: { type: "action", value: 1 }
            };
            await item.update(update);
            ui.notifications.info(`Torchmaster | Light config saved and activity created for ${item.name}`);
          } catch (err) {
            console.warn("Torchmaster | Could not create activity automatically:", err);
            ui.notifications.warn(`Torchmaster | Light config saved — please add a Utility activity manually in the Activities tab.`);
          }
        } else {
          ui.notifications.info(`Torchmaster | Light config updated for ${item.name}`);
        }
      }
    }
  });
}

// Fire when an item with a torchmaster light config is used
Hooks.on("dnd5e.useItem", async (item, config, options) => {
  if (!item) return;
  const lightConfig = item.getFlag("torchmaster", "lightConfig");
  if (!lightConfig) return;

  const actor = item.actor;
  if (!actor) return;

  const token = canvas.tokens.controlled.find(t => t.actor?.id === actor.id)
    ?? canvas.tokens.placeables.find(t => t.actor?.id === actor.id);
  if (!token) return;

  const hasLight = token.document.light.bright > 0;

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

  await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor }),
    flags: {
      world: {
        torchToggle: true,
        tokenId: token.id,
        lightConfig: lightConfig
      }
    },
    content: `
      <div style="background:#1a1a2e;border:1px solid #a2642a;border-radius:8px;padding:10px;font-family:Georgia,serif;color:#f0e6d3;">
        <div style="display:flex;align-items:center;gap:10px;margin-bottom:8px;border-bottom:1px solid #a2642a;padding-bottom:8px;">
          <img src="${item.img}" width="36" height="36" style="border-radius:4px;border:1px solid #a2642a"/>
          <strong style="font-size:1.1em;">🔥 ${item.name}</strong>
        </div>
        <p style="margin:4px 0;font-size:0.9em;">
          ${hasLight ? "🌑 The light is extinguished." : "🔥 The light flickers to life."}
        </p>
        <p style="margin:4px 0;font-size:0.85em;color:#c8a97e;">
          Bright: <strong>${lightConfig.bright}ft</strong> &nbsp;|&nbsp; Dim: <strong>${lightConfig.dim}ft</strong>
        </p>
        <div style="display:flex;gap:8px;margin-top:10px;">
          <button class="torch-btn" data-token-id="${token.id}" data-action="light"
            style="flex:1;background:#2a2a3e;color:#f0e6d3;border:1px solid #a2642a;border-radius:4px;padding:4px 8px;cursor:pointer;font-family:Georgia,serif;">
            🔥 Light
          </button>
          <button class="torch-btn" data-token-id="${token.id}" data-action="extinguish"
            style="flex:1;background:#2a2a3e;color:#f0e6d3;border:1px solid #a2642a;border-radius:4px;padding:4px 8px;cursor:pointer;font-family:Georgia,serif;">
            🌑 Extinguish
          </button>
        </div>
      </div>
    `
  });
});

// Handle chat button clicks (Foundry v13+)
Hooks.on("renderChatMessageHTML", (message, html) => {
  if (!message.flags?.world?.torchToggle) return;
  const lightConfig = message.flags.world.lightConfig;

  html.querySelectorAll(".torch-btn").forEach(btn => {
    btn.addEventListener("click", async (event) => {
      const action = event.currentTarget.dataset.action;
      const tokenId = event.currentTarget.dataset.tokenId;
      const t = canvas.tokens.get(tokenId);
      if (!t) return ui.notifications.warn("Token not found!");

      const isLighting = action === "light";
      await t.document.update({
        light: {
          bright: isLighting ? (lightConfig?.bright ?? 20) : 0,
          dim: isLighting ? (lightConfig?.dim ?? 40) : 0,
          color: lightConfig?.color ?? "#a2642a",
          animation: {
            type: isLighting ? (lightConfig?.animation ?? "torch") : "none",
            speed: lightConfig?.animationSpeed ?? 5,
            intensity: lightConfig?.animationIntensity ?? 5
          }
        }
      });
      ui.notifications.info(isLighting ? "Light on!" : "Light off!");
    });
  });
});