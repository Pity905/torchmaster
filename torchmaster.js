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
    dim: 20,
    color: "#a2642a",
    animation: "torch",
    animationSpeed: 5,
    animationIntensity: 5,
    consumptionType: "quantity",
    usesMax: 1,
    otherItemName: "",
    activationType: "action"
  };

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
        const consumptionType = form.consumptionType?.value ?? "quantity";
        const usesMax = parseInt(form.usesMax?.value) || 1;

        const config = {
          bright,
          dim: bright + additionalDim,
          color: form.color?.value ?? "#a2642a",
          animation: form.animation?.value ?? "torch",
          animationSpeed: parseInt(form.animationSpeed?.value) || 5,
          animationIntensity: parseInt(form.animationIntensity?.value) || 5,
          consumptionType,
          usesMax,
          otherItemName: form.otherItemName?.value ?? "",
          activationType: form.activationType?.value ?? "action"
        };

        await item.setFlag("torchmaster", "lightConfig", config);

        // Auto-configure item based on consumption type
        const itemUpdate = {};

        if (consumptionType === "uses") {
          itemUpdate["system.uses.max"] = usesMax;
          itemUpdate["system.uses.spent"] = 0;
        }

        if (Object.keys(itemUpdate).length > 0) {
          await item.update(itemUpdate);
        }

        // Create or update the Light Torch activity
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
                type: config.activationType,
                value: 1,
                condition: ""
              },
              duration: { value: "", units: "", special: "" },
              target: {
                template: { count: "", contiguous: false, type: "", size: "", width: "", height: "", units: "" },
                affects: { count: "", type: "", choice: false, special: "" },
                prompt: false
              },
              range: { value: null, units: "", special: "" },
              uses: { spent: 0, max: "", recovery: [] },
              consumption: { targets: [], scaling: { allowed: false, max: "" } },
              effects: [],
              roll: { prompt: false, visible: false, name: "", formula: "" }
            };
            await item.update(update);
            ui.notifications.info(`Torchmaster | Light config saved and "Light Torch" activity created for ${item.name}`);
          } catch (err) {
            console.warn("Torchmaster | Could not create activity:", err);
            ui.notifications.warn(`Torchmaster | Light config saved — please add a Utility activity manually.`);
          }
        } else {
          // Update activation type on existing activity
          try {
            const existingEntry = activityValues.find(a => a.name === "Light Torch");
            if (existingEntry?._id) {
              await item.update({
                [`system.activities.${existingEntry._id}.activation.type`]: config.activationType
              });
            }
          } catch (err) {
            console.warn("Torchmaster | Could not update activity activation type:", err);
          }
          ui.notifications.info(`Torchmaster | Light config updated for ${item.name}`);
        }
      }
    }
  });
}

// Helper — consume based on config type
async function consumeLight(item, actor, config) {
  const type = config.consumptionType ?? "quantity";

  if (type === "none") return { success: true, remaining: null };

  if (type === "quantity") {
    const quantity = item.system.quantity ?? 0;
    if (quantity <= 0) return { success: false, remaining: 0 };
    const newQty = Math.max(quantity - 1, 0);
    await item.update({ "system.quantity": newQty });
    return { success: true, remaining: newQty };
  }

  if (type === "uses") {
    const spent = item.system.uses?.spent ?? 0;
    const max = parseInt(item.system.uses?.max) || config.usesMax || 1;
    if (spent >= max) return { success: false, remaining: 0 };
    await item.update({ "system.uses.spent": spent + 1 });
    return { success: true, remaining: max - spent - 1 };
  }

  if (type === "otherItem") {
    const otherName = config.otherItemName ?? "";
    if (!otherName) return { success: false, remaining: null };
    const otherItem = actor.items.find(i => i.name === otherName);
    if (!otherItem) {
      ui.notifications.warn(`Torchmaster | Could not find "${otherName}" in ${actor.name}'s inventory.`);
      return { success: false, remaining: null };
    }
    const quantity = otherItem.system.quantity ?? 0;
    if (quantity <= 0) return { success: false, remaining: 0 };
    const newQty = Math.max(quantity - 1, 0);
    await otherItem.update({ "system.quantity": newQty });
    return { success: true, remaining: newQty, otherItemName: otherName };
  }

  return { success: true, remaining: null };
}

// Helper — check if light source has supplies remaining
function hasSupplies(item, actor, config) {
  const type = config.consumptionType ?? "quantity";
  if (type === "none") return true;
  if (type === "quantity") return (item.system.quantity ?? 0) > 0;
  if (type === "uses") {
    const spent = item.system.uses?.spent ?? 0;
    const max = parseInt(item.system.uses?.max) || config.usesMax || 1;
    return spent < max;
  }
  if (type === "otherItem") {
    const otherItem = actor.items.find(i => i.name === (config.otherItemName ?? ""));
    return (otherItem?.system.quantity ?? 0) > 0;
  }
  return true;
}

// Helper — remaining supplies label
function suppliesLabel(item, actor, config) {
  const type = config.consumptionType ?? "quantity";
  if (type === "none") return null;
  if (type === "quantity") return `${item.system.quantity ?? 0} remaining`;
  if (type === "uses") {
    const spent = item.system.uses?.spent ?? 0;
    const max = parseInt(item.system.uses?.max) || config.usesMax || 1;
    return `${max - spent}/${max} uses remaining`;
  }
  if (type === "otherItem") {
    const otherItem = actor.items.find(i => i.name === (config.otherItemName ?? ""));
    return `${otherItem?.system.quantity ?? 0} ${config.otherItemName ?? "item"}(s) remaining`;
  }
  return null;
}

// Build chat card content
function buildChatContent(item, token, actor, lightConfig, turningOn) {
  const type = lightConfig.consumptionType ?? "quantity";
  const label = suppliesLabel(item, actor, lightConfig);
  const showBurnOut = type !== "none";

  const burnOutLabel = {
    quantity: "💀 Burn Out",
    uses: "💧 Use Up",
    otherItem: `💧 Consume ${lightConfig.otherItemName || "Item"}`
  }[type] ?? "💀 Burn Out";

  const confirmText = {
    quantity: `consume one ${item.name} from`,
    uses: `use up one charge of ${item.name} from`,
    otherItem: `consume one ${lightConfig.otherItemName || "item"} from`
  }[type] ?? "consume a resource from";

  return `
    <div style="background:#1a1a2e;border:1px solid #a2642a;border-radius:8px;padding:10px;font-family:Georgia,serif;color:#f0e6d3;">
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:8px;border-bottom:1px solid #a2642a;padding-bottom:8px;">
        <img src="${item.img}" width="36" height="36" style="border-radius:4px;border:1px solid #a2642a"/>
        <strong style="font-size:1.1em;">🔥 ${item.name}</strong>
      </div>
      <p style="margin:4px 0;font-size:0.9em;">
        ${turningOn ? "🔥 The light flickers to life." : "🌑 The light is extinguished safely."}
      </p>
      <p style="margin:4px 0;font-size:0.85em;color:#c8a97e;">
        Bright: <strong>${lightConfig.bright}ft</strong> &nbsp;|&nbsp; Dim: <strong>${lightConfig.dim}ft</strong>
        ${label ? `&nbsp;|&nbsp; ${label}` : ""}
      </p>
      <div style="display:flex;gap:8px;margin-top:10px;">
        <button class="torch-btn"
          data-token-id="${token.id}"
          data-actor-id="${actor.id}"
          data-item-id="${item.id}"
          data-action="light"
          data-confirm-text="${confirmText}"
          style="flex:1;background:#2a2a3e;color:#f0e6d3;border:1px solid #a2642a;border-radius:4px;padding:4px 8px;cursor:pointer;font-family:Georgia,serif;">
          🔥 Light
        </button>
        <button class="torch-btn"
          data-token-id="${token.id}"
          data-actor-id="${actor.id}"
          data-item-id="${item.id}"
          data-action="extinguish"
          style="flex:1;background:#2a2a3e;color:#f0e6d3;border:1px solid #a2642a;border-radius:4px;padding:4px 8px;cursor:pointer;font-family:Georgia,serif;">
          🌑 Extinguish
        </button>
        ${showBurnOut ? `
        <button class="torch-btn"
          data-token-id="${token.id}"
          data-actor-id="${actor.id}"
          data-item-id="${item.id}"
          data-action="burnout"
          data-confirm-text="${confirmText}"
          style="flex:1;background:#3a1a1a;color:#f0e6d3;border:1px solid #8b2a2a;border-radius:4px;padding:4px 8px;cursor:pointer;font-family:Georgia,serif;">
          ${burnOutLabel}
        </button>` : ""}
      </div>
    </div>
  `;
}

// Helper — get whisper recipient IDs (actor owners + all GMs)
function getTorchWhispers(actor) {
  return game.users
    .filter(u => u.isGM || actor.testUserPermission(u, "OWNER"))
    .map(u => u.id);
}

// Toggle token light from the Light Torch activity
async function toggleTorchLightFromActivity(activity) {
  if (!activity) return;
  const item = activity.item;
  if (!item) return;
  if (activity.name !== "Light Torch") return;

  const lightConfig = item.getFlag("torchmaster", "lightConfig") ?? {
    bright: 20,
    dim: 40,
    color: "#a2642a",
    animation: "torch",
    animationSpeed: 5,
    animationIntensity: 5,
    consumptionType: "quantity",
    usesMax: 1,
    otherItemName: "",
    activationType: "action"
  };

  const actor = item.actor;
  if (!actor) return;

  const token =
    canvas.tokens.controlled.find(t => t.actor?.id === actor.id) ??
    canvas.tokens.placeables.find(t => t.actor?.id === actor.id);

  if (!token) {
    ui.notifications.warn("Torchmaster | No token found for this actor.");
    return;
  }

  const currentLight = token.document.light ?? {};
  const hasLight = (currentLight.bright ?? 0) > 0 || (currentLight.dim ?? 0) > 0;
  const turningOn = !hasLight;

  // If turning on, check supplies
  if (turningOn) {
    if (!hasSupplies(item, actor, lightConfig)) {
      await ChatMessage.create({
        speaker: ChatMessage.getSpeaker({ actor }),
        whisper: getTorchWhispers(actor),
        content: `
          <div style="background:#1a1a2e;border:1px solid #8b2a2a;border-radius:8px;padding:10px;font-family:Georgia,serif;color:#f0e6d3;">
            <div style="display:flex;align-items:center;gap:10px;">
              <img src="${item.img}" width="36" height="36" style="border-radius:4px;border:1px solid #8b2a2a"/>
              <strong>🌑 No supplies remaining</strong>
            </div>
            <p style="margin:8px 0 0;font-size:0.9em;color:#c8a97e;">
              ${actor.name} reaches for a light source but finds nothing left.
            </p>
          </div>
        `
      });
      return;
    }
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

  await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor }),
    whisper: getTorchWhispers(actor),
    flags: {
      world: {
        torchToggle: true,
        tokenId: token.id,
        actorId: actor.id,
        itemId: item.id,
        lightConfig,
        isLit: turningOn
      }
    },
    content: buildChatContent(item, token, actor, lightConfig, turningOn)
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
      const confirmText = event.currentTarget.dataset.confirmText;
      const t = canvas.tokens.get(tokenId);
      if (!t) return ui.notifications.warn("Torchmaster | Token not found!");

      const actor = t.actor ?? game.actors.get(actorId);
      const item = actor?.items.get(itemId);

      if (action === "light") {
        if (!hasSupplies(item, actor, lightConfig)) {
          return ui.notifications.warn(`Torchmaster | ${actor?.name ?? "Token"} has no supplies left!`);
        }
        await t.document.unsetFlag("torchmaster", "burnedOut");
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
        ui.notifications.info("🔥 Light on!");

      } else if (action === "extinguish") {
        await t.document.update({
          light: { bright: 0, dim: 0, animation: { type: "none" } }
        });
        ui.notifications.info("🌑 Extinguished safely — not consumed.");

      } else if (action === "burnout") {
        const { DialogV2 } = foundry.applications.api;
        const confirmed = await DialogV2.confirm({
          window: { title: "Consume Light Source?" },
          content: `<p style="padding:8px;">This will extinguish the light and ${confirmText ?? "consume a resource from"} <strong>${actor?.name ?? "the actor"}</strong>'s inventory. Are you sure?</p>`,
          yes: { label: "Yes, consume it" },
          no: { label: "Cancel" }
        });
        if (!confirmed) return;

        await t.document.update({
          light: { bright: 0, dim: 0, animation: { type: "none" } }
        });
        await t.document.setFlag("torchmaster", "burnedOut", true);

        if (item) {
          const result = await consumeLight(item, actor, lightConfig);
          if (result.success) {
            const remaining = result.remaining !== null ? ` ${result.remaining} remaining.` : "";
            ui.notifications.info(`💀 Light consumed. ${actor?.name}:${remaining}`);
          } else {
            ui.notifications.warn(`Torchmaster | Nothing left to consume for ${actor?.name}.`);
          }
        } else {
          ui.notifications.warn("Torchmaster | Could not find item to consume.");
        }
      }
    });
  });
});