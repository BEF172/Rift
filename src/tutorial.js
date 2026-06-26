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

  const setTutorialChrome = (active) => {
    document.body.classList.toggle("rift-atlas-tutorial-active", Boolean(active));
    if (active) {
      document.querySelector(".sidebar")?.classList.remove("is-open");
    }
  };

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
      driverInstance?.destroy?.();
    });

    label.append(checkbox, text);
    controls.append(label, skipButton);
    popover.footer.append(controls);
  };

  const renderControls = (options) => (popover, context = {}) => {
    renderIntroControls(popover, context.driver || activeTutorial, options);
  };

  const getTutorialIndex = (tutorial) => {
    const directIndex = Number(tutorial?.getActiveIndex?.());
    if (Number.isFinite(directIndex)) return directIndex;
    const stateIndex = Number(tutorial?.getState?.()?.activeIndex);
    return Number.isFinite(stateIndex) ? stateIndex : 0;
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
    setTutorialChrome(true);

    const setupResult = options.setupResult || null;
    const setupNeedsAttention = setupResult?.complete === false || setupResult?.injectionReady === false;
    const steps = [];

    if (setupNeedsAttention) {
      steps.push({
        element: "#downloadProgressLabel",
        popover: {
          title: setupResult?.complete === false ? "La preparacion necesita atencion" : "Descargas automaticas listas",
          description: setupResult?.complete === false
            ? "Rift Atlas no pudo completar algun componente. Revisa este estado y usa los botones de Descargas solo para reintentar lo que haya fallado."
            : "Engine, LeagueSkins y Pengu ya se instalaron automaticamente. Solo falta agregar cslol-dll.dll para habilitar la inyeccion.",
          onPopoverRender: renderControls(options)
        },
        onHighlightStarted: () => goToView("downloads")
      });
    }

    steps.push(
      {
        element: '[data-view="mods"]',
        popover: {
          title: "Tus skins ya estan preparadas",
          description: "La biblioteca se descargo automaticamente. Entra a Skins para elegir lo que queres usar o agregar mods propios.",
          onPopoverRender: renderControls(options)
        },
        onHighlightStarted: () => goToView("mods")
      },
      {
        element: "#customModsList",
        popover: {
          title: "Elegi una skin",
          description: "Toca una skin de la biblioteca para agregarla a la seleccion. Podes combinar varias antes de ejecutar el overlay.",
          onPopoverRender: renderControls(options)
        },
        onHighlightStarted: () => goToView("mods")
      },
      {
        element: "#modDropZone",
        popover: {
          title: "Tambien podes usar mods propios",
          description: "Arrastra aca archivos .fantome, .zip, .rse, .wad o .wad.client. Este paso es opcional.",
          onPopoverRender: renderControls(options)
        },
        onHighlightStarted: () => goToView("mods")
      },
      {
        element: "#selectionTraySummary",
        popover: {
          title: "Revisa tu seleccion",
          description: "Aca ves cuantas skins quedan preparadas antes de pasar al Overlay.",
          onPopoverRender: renderControls(options)
        },
        onHighlightStarted: () => goToView("mods")
      },
      {
        element: "#overlayLaunchPenguButton",
        popover: {
          title: "Activa Pengu",
          description: "Activalo antes de abrir League para detectar champ select y mostrar las skins elegidas.",
          onPopoverRender: renderControls(options)
        },
        onHighlightStarted: () => goToView("overlay")
      },
      {
        element: "#overlayPenguStatusLabel",
        popover: {
          title: "Comprueba la conexion",
          description: "Este estado confirma si Pengu esta conectado y Rift Atlas espera la seleccion de campeon.",
          onPopoverRender: renderControls(options)
        },
        onHighlightStarted: () => goToView("overlay")
      },
      {
        element: "#selectionActionBar",
        popover: {
          title: "Aplica la seleccion",
          description: "Cuando haya skins seleccionadas, usa Aplicar. Deja Rift Atlas abierto mientras jugas; Detener apaga el overlay activo.",
          onPopoverRender: renderControls(options)
        },
        onHighlightStarted: () => goToView("overlay")
      },
      {
        popover: {
          title: "Todo listo",
          description: "El flujo habitual es simple: elegi skins, activa Pengu y aplica la seleccion antes de entrar a partida.",
          onPopoverRender: renderControls(options)
        }
      }
    );

    goToView(setupNeedsAttention ? "downloads" : "mods");

    const tutorial = createDriver({
      showProgress: true,
      animate: true,
      allowClose: true,
      nextBtnText: "Siguiente",
      prevBtnText: "Anterior",
      doneBtnText: "Listo",
      progressText: "{{current}} de {{total}}",
      onDestroyed: () => {
        setTutorialChrome(false);
        activeTutorial = null;
        if (!suppressDestroyedMark) markIntroSeen();
        if (!suppressDestroyedMark) {
          window.dispatchEvent(new CustomEvent("rift-atlas:tutorial-ended"));
        }
      },
      steps
    });

    try {
      activeTutorial = tutorial;
      tutorial.drive(Number(options.resumeIndex || 0));
      tutorialPausedForModal = false;
      return true;
    } catch (error) {
      setTutorialChrome(false);
      return false;
    }
  };

  window.riftAtlasTutorial = {
    isActive: () => Boolean(activeTutorial?.isActive?.()),
    isPaused: () => tutorialPausedForModal,
    pauseForModal: () => {
      if (!activeTutorial?.isActive?.()) return false;
      pausedTutorialIndex = getTutorialIndex(activeTutorial);
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
