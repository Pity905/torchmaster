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
  menuItem.find("button").on("click", () => openLightConfig(app.item ?? app.document));
}

Hooks.on("renderItemSheet", addLightConfigButton);
Hooks.on("renderTidy5eItemSheetQuadrone", addLightConfigButton);

// Open the light config dialog
async function openLightConfig(item) {
  const stored = item.getFlag("torchmaster", "lightConfig") ?? {
    bright: 20,
    dim: 40,
    color: "#a2642a",
    animation: "torch",
    animationSpeed: 5,
    animationIntensity: 5
  };

  // Show dim in the form as "additional dim beyond bright"
  const saved = {
    ...stored,
    dim: Math.max((stored.dim ?? 0) - (stored.bright ?? 0), 0)
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
        const form =
          button.form ??
          button.closest("form") ??
          button.closest(".window-content")?.querySelector("form");

        if (!form) {
          ui.notifications.error("Torchmaster | Could not find config form.");
          return;
        }

        const bright = parseInt(form.bright?.value) || 0;
        const additionalDim = parseInt(form.dim?.value) || 0;

        const config = {
          bright,
          dim: bright + additionalDim,
          color: form.color?.value ?? "#a2642a",
          animation: form.animation?.value ?? "torch",
          animationSpeed: parseInt(form.animationSpeed?.value) || 5,
          animationIntensity: parseInt(form.animationIntensity?.value) || 5
        };

        await item.setFlag("torchmaster", "lightConfig", config);

        // Check if Light Torch activity already exists
        const activities = item.system.activities;
        const activityValues = activities
          ? (typeof activities.values === "function" ? [...activities.values()] : Object.values(activities))
          : [];
        const hasActivity = activityValues.some(a => a.name === "Light Torch");

        if (!hasActivity) {
          try {
            const newId = foundry.utils.randomID();
            const update = {};
            update[`system.activities.${newId}`] = {
              _id: newId,
              type: "utility",
              name: "Light Torch",
              img: item.img ?? "icons/sundries/lights/torch-brown-lit.webp",
              activation: {
                type: "action",
                value: 1,
                condition: ""
              },
              duration: {
                value: "",
                units: "",
                special: ""
              },
              target: {
                template: { count: "", contiguous: false, type: "", size: "", width: "", height: "", units: "" },
                affects: { count: "", type: "", choice: false, special: "" },
                prompt: false
              },
              range: {
                value: null,
                units: "",
                special: ""
              },
              uses: {
                spent: 0,
                max: "",
                recovery: []
              },
              consumption: {
                targets: [],
                scaling: { allowed: false, max: "" }
              },
              effects: [],
              roll: { prompt: false, visible: false, name: "", formula: "" }
            };
            await item.update(update);
            ui.notifications.info(`Torchmaster | Light config saved and "Light Torch" activity created for ${item.name}`);
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

// Toggle token light from the Light Torch activity
async function toggleTorchLightFromActivity(activity) {
  if (!activity) return;

  const item = activity.item;
  if (!item) return;

  if (activity.name !== "Light Torch") return;

  const lightConfig = item.getFlag("torchmaster", "lightConfig");
  if (!lightConfig) return;

  const actor = item.actor;
  if (!actor) return;

  const token =
    canvas.tokens.controlled.find(t => t.actor?.id === actor.id) ??
    canvas.tokens.placeables.find(t => t.actor?.id === actor.id);

  if (!token) {
    ui.notifications.warn("Torchmaster | No token found for this actor.");
    return;
  }

  // Check if torch is burned out
  const burnedOut = token.document.getFlag("torchmaster", "burnedOut");
  const currentLight = token.document.light ?? {};
  const hasLight = (currentLight.bright ?? 0) > 0 || (currentLight.dim ?? 0) > 0;
  const turningOn = !hasLight;

  // Block relighting if burned out and no torches left
  if (turningOn && burnedOut) {
    const quantity = item.system.quantity ?? 0;
    if (quantity <= 0) {
      ui.notifications.warn(`Torchmaster | ${actor.name} has no torches left!`);
      return;
    }
    // Clear burned out flag since they have torches
    await token.document.unsetFlag("torchmaster", "burnedOut");
  }

  await token.document.update({
    light: {
      bright: turningOn ? (lightConfig.bright ?? 20) : 0,
      dim: turningOn ? (lightConfig.dim ?? 40) : 0,
      color: lightConfig.color ?? "#a2642a",
      animation: {
        type: turningOn ? (lightConfig.animation ?? "torch") : "none",
        speed: turningOn ? (lightConfig.animationSpeed ?? 5) : 0,
        intensity: turningOn ? (lightConfig.animationIntensity ?? 5) : 0
      }
    }
  });

  // Post chat card
  await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor }),
    flags: {
      world: {
        torchToggle: true,
        tokenId: token.id,
        actorId: actor.id,
        itemId: item.id,
        lightConfig: lightConfig,
        isLit: turningOn
      }
    },
    content: `
      <div style="background:#1a1a2e;border:1px solid #a2642a;border-radius:8px;padding:10px;font-family:Georgia,serif;color:#f0e6d3;">
        <div style="display:flex;align-items:center;gap:10px;margin-bottom:8px;border-bottom:1px solid #a2642a;padding-bottom:8px;">
          <img src="${item.img}" width="36" height="36" style="border-radius:4px;border:1px solid #a2642a"/>
          <strong style="font-size:1.1em;">🔥 ${item.name}</strong>
        </div>
        <p style="margin:4px 0;font-size:0.9em;">
          ${turningOn ? "🔥 The torch flickers to life." : "🌑 The torch is extinguished safely."}
        </p>
        <p style="margin:4px 0;font-size:0.85em;color:#c8a97e;">
          Bright: <strong>${lightConfig.bright}ft</strong> &nbsp;|&nbsp; Dim: <strong>${lightConfig.dim}ft</strong>
          &nbsp;|&nbsp; Torches left: <strong>${item.system.quantity ?? 0}</strong>
        </p>
        <div style="display:flex;gap:8px;margin-top:10px;">
          <button class="torch-btn" data-token-id="${token.id}" data-actor-id="${actor.id}" data-item-id="${item.id}" data-action="light"
            style="flex:1;background:#2a2a3e;color:#f0e6d3;border:1px solid #a2642a;border-radius:4px;padding:4px 8px;cursor:pointer;font-family:Georgia,serif;">
            🔥 Light
          </button>
          <button class="torch-btn" data-token-id="${token.id}" data-actor-id="${actor.id}" data-item-id="${item.id}" data-action="extinguish"
            style="flex:1;background:#2a2a3e;color:#f0e6d3;border:1px solid #a2642a;border-radius:4px;padding:4px 8px;cursor:pointer;font-family:Georgia,serif;">
            🌑 Extinguish
          </button>
          <button class="torch-btn" data-token-id="${token.id}" data-actor-id="${actor.id}" data-item-id="${item.id}" data-action="burnout"
            style="flex:1;background:#3a1a1a;color:#f0e6d3;border:1px solid #8b2a2a;border-radius:4px;padding:4px 8px;cursor:pointer;font-family:Georgia,serif;">
            💀 Burn Out
          </button>
        </div>
      </div>
    `
  });
}

// Fires when an activity is used
Hooks.on("dnd5e.postCreateUsageMessage", async (activity, card) => {
  try {
    await toggleTorchLightFromActivity(activity);
  } catch (err) {
    console.error("Torchmaster | Failed to toggle torch light from activity", err);
  }
});

// Handle chat button clicks (Foundry v13+)
Hooks.on("renderChatMessageHTML", (message, html) => {
  if (!message.flags?.world?.torchToggle) return;

  const { tokenId, actorId, itemId, lightConfig } = message.flags.world;

  html.querySelectorAll(".torch-btn").forEach(btn => {
    btn.addEventListener("click", async (event) => {
      const action = event.currentTarget.dataset.action;
      const t = canvas.tokens.get(tokenId);
      if (!t) return ui.notifications.warn("Torchmaster | Token not found!");

      const actor = game.actors.get(actorId);
      const item = actor?.items.get(itemId);

      if (action === "light") {
        // Check burned out flag and quantity
        const burnedOut = t.document.getFlag("torchmaster", "burnedOut");
        if (burnedOut) {
          const quantity = item?.system.quantity ?? 0;
          if (quantity <= 0) {
            return ui.notifications.warn(`Torchmaster | ${actor?.name ?? "Token"} has no torches left!`);
          }
          await t.document.unsetFlag("torchmaster", "burnedOut");
        }
        await t.document.update({
          light: {
            bright: lightConfig?.bright ?? 20,
            dim: lightConfig?.dim ?? 40,
            color: lightConfig?.color ?? "#a2642a",
            animation: {
              type: lightConfig?.animation ?? "torch",
              speed: lightConfig?.animationSpeed ?? 5,
              intensity: lightConfig?.animationIntensity ?? 5
            }
          }
        });
        ui.notifications.info("🔥 Torch lit!");

      } else if (action === "extinguish") {
        await t.document.update({
          light: { bright: 0, dim: 0, animation: { type: "none" } }
        });
        ui.notifications.info("🌑 Torch extinguished safely — not consumed.");

      } else if (action === "burnout") {
        // Confirm before consuming
        const { DialogV2 } = foundry.applications.api;
        const confirmed = await DialogV2.confirm({
          window: { title: "Burn Out Torch?" },
          content: `<p style="padding:8px;">This will extinguish the light and consume one torch from ${actor?.name ?? "the actor"}'s inventory. Are you sure?</p>`,
          yes: { label: "Yes, burn it out" },
          no: { label: "Cancel" }
        });
        if (!confirmed) return;

        // Extinguish light
        await t.document.update({
          light: { bright: 0, dim: 0, animation: { type: "none" } }
        });

        // Set burned out flag
        await t.document.setFlag("torchmaster", "burnedOut", true);

        // Consume one torch
        if (item) {
          const quantity = item.system.quantity ?? 0;
          const newQuantity = Math.max(quantity - 1, 0);
          await item.update({ "system.quantity": newQuantity });
          ui.notifications.info(`💀 Torch burned out. ${actor?.name} has ${newQuantity} torch${newQuantity !== 1 ? "es" : ""} remaining.`);
        } else {
          ui.notifications.warn("Torchmaster | Could not find torch item to consume.");
        }
      }
    });
  });
});