(function () {
  const INTRO_SEEN_KEY = "riftAtlas:tutorialIntroSeen:v2";
  const INTRO_DISABLED_KEY = "riftAtlas:tutorialIntroDisabled";
  const getDriverFactory = () => window.driver?.js?.driver || window.driver?.driver;

  const hasSeenIntro = () => localStorage.getItem(INTRO_SEEN_KEY) === "1";
  const isIntroDisabled = () => localStorage.getItem(INTRO_DISABLED_KEY) === "1";
  const markIntroSeen = () => localStorage.setItem(INTRO_SEEN_KEY, "1");
  const disableIntro = () => {
    localStorage.setItem(INTRO_SEEN_KEY, "1");
    localStorage.setItem(INTRO_DISABLED_KEY, "1");
  };
  let activeTutorial = null;
  let activeOpenView = null;
  let activeOptions = {};
  let pausedTutorialIndex = 0;
  let tutorialPausedForModal = false;
  let suppressDestroyedMark = false;

  const renderIntroControls = (popover, driverInstance, options) => {
    if (!options.showIntroControls || !popover?.footer) return;
    if (popover.footer.querySelector(".tutorial-intro-controls")) return;

    const controls = document.createElement("div");
    controls.className = "tutorial-intro-controls";

    const label = document.createElement("label");
    label.className = "tutorial-intro-check";

    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = isIntroDisabled();
    checkbox.addEventListener("change", () => {
      if (checkbox.checked) disableIntro();
    });

    const text = document.createElement("span");
    text.textContent = "No mostrar mas";

    const skipButton = document.createElement("button");
    skipButton.className = "tutorial-skip-button";
    skipButton.type = "button";
    skipButton.textContent = "Omitir";
    skipButton.addEventListener("click", () => {
      markIntroSeen();
      if (checkbox.checked) disableIntro();
      driverInstance.destroy();
    });

    label.append(checkbox, text);
    controls.append(label, skipButton);
    popover.footer.append(controls);
  };

  window.startRiftAtlasTutorial = function startRiftAtlasTutorial(openView, options = {}) {
    const createDriver = getDriverFactory();
    if (!createDriver) {
      if (options.retry !== false) {
        setTimeout(() => window.startRiftAtlasTutorial(openView, { ...options, retry: false }), 700);
      }
      return false;
    }

    if (options.autoStart) {
      if (!options.force && (hasSeenIntro() || isIntroDisabled())) return false;
      markIntroSeen();
    }

    const goToView = typeof openView === "function" ? openView : () => {};
    activeOpenView = openView;
    activeOptions = options;
    goToView("downloads");

    const tutorial = createDriver({
      showProgress: true,
      animate: true,
      allowClose: true,
      nextBtnText: "Siguiente",
      prevBtnText: "Anterior",
      doneBtnText: "Listo",
      progressText: "{{current}} de {{total}}",
      onDestroyed: () => {
        activeTutorial = null;
        if (!suppressDestroyedMark) markIntroSeen();
      },
      steps: [
        {
          element: "#downloadEngineButton",
          popover: {
            title: "Descargar Engine",
            description: "Descarga el Engine necesario para Rift Atlas.",
            onPopoverRender: (popover, { driver }) => renderIntroControls(popover, driver, options)
          },
          onHighlightStarted: () => {
            goToView("downloads");
          }
        },
        {
          element: "#downloadLeagueSkinsButtonDownload",
          popover: {
            title: "Descargar LeagueSkins",
            description: "Descarga la biblioteca de skins.",
            onPopoverRender: (popover, { driver }) => renderIntroControls(popover, driver, options)
          }
        },
        {
          element: "#autoConfigureButton",
          popover: {
            title: "Detectar League",
            description: "Presiona Detectar para localizar League automaticamente.",
            onPopoverRender: (popover, { driver }) => renderIntroControls(popover, driver, options)
          },
          onHighlightStarted: () => {
            goToView("settings");
          }
        },
        {
          element: "#leagueGamePathLabel",
          popover: {
            title: "Ruta de League",
            description: "La ruta correcta es Game\\League of Legends.exe.",
            onPopoverRender: (popover, { driver }) => renderIntroControls(popover, driver, options)
          },
          onHighlightStarted: () => {
            goToView("settings");
          }
        },
        {
          element: "#leagueSkinsLocalPanel",
          popover: {
            title: "Seleccionar Skins",
            description: "Elige las skins o mods que quieras utilizar.",
            onPopoverRender: (popover, { driver }) => renderIntroControls(popover, driver, options)
          },
          onHighlightStarted: () => {
            goToView("mods");
          }
        },
        {
          element: "#bottomApplyButton",
          popover: {
            title: "Ejecutar",
            description: "Presiona Aplicar para iniciar el overlay.",
            onPopoverRender: (popover, { driver }) => renderIntroControls(popover, driver, options)
          },
          onHighlightStarted: () => {
            goToView("overlay");
          }
        },
        {
          element: "#overlayStatusLabel",
          popover: {
            title: "Estado",
            description: "Cargando: espera. Overlay activo: entra a partida.",
            onPopoverRender: (popover, { driver }) => renderIntroControls(popover, driver, options)
          }
        },
        {
          popover: {
            title: "Listo",
            description: "Deja Rift Atlas abierto mientras juegas. Cerrar la aplicacion puede hacer que las skins dejen de funcionar.",
            onPopoverRender: (popover, { driver }) => renderIntroControls(popover, driver, options)
          }
        }
      ]
    });

    try {
      activeTutorial = tutorial;
      tutorial.drive(Number(options.resumeIndex || 0));
      tutorialPausedForModal = false;
      return true;
    } catch (error) {
      return false;
    }
  };

  window.riftAtlasTutorial = {
    isActive: () => Boolean(activeTutorial?.isActive?.()),
    isPaused: () => tutorialPausedForModal,
    pauseForModal: () => {
      if (!activeTutorial?.isActive?.()) return false;
      pausedTutorialIndex = Number(activeTutorial.getActiveIndex?.() || 0);
      tutorialPausedForModal = true;
      suppressDestroyedMark = true;
      activeTutorial.destroy();
      suppressDestroyedMark = false;
      return true;
    },
    resumeAfterModal: () => {
      if (!tutorialPausedForModal) return false;
      const index = pausedTutorialIndex;
      tutorialPausedForModal = false;
      return window.startRiftAtlasTutorial(activeOpenView, {
        ...activeOptions,
        force: true,
        resumeIndex: index
      });
    }
  };
})();
