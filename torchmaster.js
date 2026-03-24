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

  // Only run for the manual Light Torch activity
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

  const currentLight = token.document.light ?? {};
  const hasLight =
    (currentLight.bright ?? 0) > 0 ||
    (currentLight.dim ?? 0) > 0;

  const turningOn = !hasLight;

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
}

// Fires when an activity is used
Hooks.on("dnd5e.postCreateUsageMessage", async (activity, card) => {
  try {
    await toggleTorchLightFromActivity(activity);
  } catch (err) {
    console.error("Torchmaster | Failed to toggle torch light from activity", err);
  }
});