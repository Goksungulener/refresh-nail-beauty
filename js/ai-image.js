import { supabase } from "./supabaseClient.js";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "./config.js";

// FLUX API'ye gönderilecek görselin en uzun kenarı bu değeri aşarsa küçültülür
// (telefon fotoğrafları çok büyük olabiliyor, bu hem hızlandırır hem de
// Edge Function'ın istek boyutu sınırına takılmayı önler).
const MAX_SUBMIT_DIMENSION = 1600;

let BRUSH_RADIUS = 20;
let scale = 1;
let originalImage = null;
let imageNode = null;
let isDrawing = false;

async function callFluxFill(payload) {
  const { data: sessionData } = await supabase.auth.getSession();
  const accessToken = sessionData?.session?.access_token;
  if (!accessToken) throw new Error("Oturum bulunamadı, lütfen tekrar giriş yapın.");

  const response = await fetch(`${SUPABASE_URL}/functions/v1/flux-fill`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
      apikey: SUPABASE_ANON_KEY,
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    let message = `HTTP ${response.status}`;
    try {
      const errJson = await response.json();
      if (errJson.error) message = errJson.error;
    } catch {
      // yanıt json değilse durum kodu ile devam et
    }
    throw new Error(message);
  }

  return response.blob();
}

function initAiImageEditor() {
  const container = document.getElementById("ai-container");
  if (!container) return; // AI Görsel sekmesi bu sayfada yok

  const stage = new Konva.Stage({
    container: "ai-container",
    width: 100,
    height: 100,
  });

  const layer = new Konva.Layer();
  const maskLayer = new Konva.Layer();
  stage.add(layer);
  stage.add(maskLayer);
  maskLayer.visible(false);

  const stepsSlider = document.getElementById("ai-stepsSlider");
  const stepsValue = document.getElementById("ai-stepsValue");
  const guidanceSlider = document.getElementById("ai-guidanceSlider");
  const guidanceValue = document.getElementById("ai-guidanceValue");
  const brushSlider = document.getElementById("ai-brushSize");
  const brushSizeValue = document.getElementById("ai-brushSizeValue");
  const cursor = document.getElementById("ai-cursor");
  const fileInput = document.getElementById("ai-fileInput");
  const uploadButton = document.getElementById("ai-uploadButton");
  const clearButton = document.getElementById("ai-clearButton");
  const sendButton = document.getElementById("ai-sendButton");
  const loadingIndicator = document.getElementById("ai-loadingIndicator");
  const imageInfo = document.getElementById("ai-imageInfo");
  const promptInput = document.getElementById("ai-promptInput");
  const improvePrompt = document.getElementById("ai-improvePrompt");

  stepsSlider.addEventListener("input", (e) => {
    stepsValue.textContent = e.target.value;
  });

  guidanceSlider.addEventListener("input", (e) => {
    guidanceValue.textContent = parseFloat(e.target.value).toFixed(1);
  });

  function updateCursorSize() {
    cursor.style.width = BRUSH_RADIUS * 2 * scale + "px";
    cursor.style.height = BRUSH_RADIUS * 2 * scale + "px";
    cursor.style.marginLeft = -(BRUSH_RADIUS * scale) + "px";
    cursor.style.marginTop = -(BRUSH_RADIUS * scale) + "px";
  }
  updateCursorSize();

  brushSlider.addEventListener("input", (e) => {
    BRUSH_RADIUS = parseInt(e.target.value, 10);
    brushSizeValue.textContent = BRUSH_RADIUS + "px";
    updateCursorSize();
  });

  stage.container().addEventListener("wheel", (e) => {
    e.preventDefault();
    const MIN_RADIUS = 5;
    const MAX_RADIUS = 40;
    BRUSH_RADIUS =
      e.deltaY > 0
        ? Math.max(MIN_RADIUS, BRUSH_RADIUS - 2)
        : Math.min(MAX_RADIUS, BRUSH_RADIUS + 2);
    updateCursorSize();
    brushSlider.value = BRUSH_RADIUS;
    brushSizeValue.textContent = `${BRUSH_RADIUS}px`;
  });

  function initializeMaskLayer(width, height) {
    maskLayer.destroyChildren();
    maskLayer.add(new Konva.Rect({ x: 0, y: 0, width, height, fill: "black" }));
    maskLayer.draw();
  }

  function loadImage(src) {
    const img = new Image();
    img.onload = handleImageLoad;
    img.onerror = () => alert("Görsel yüklenemedi.");
    img.src = src;

    function handleImageLoad() {
      if (imageNode) imageNode.destroy();

      originalImage = img;
      const imgWidth = img.width;
      const imgHeight = img.height;
      const maxWidth = 1200;
      const maxHeight = 650;

      scale = 1;
      if (imgWidth > maxWidth || imgHeight > maxHeight) {
        scale = Math.min(maxWidth / imgWidth, maxHeight / imgHeight);
      }

      const displayWidth = Math.round(imgWidth * scale);
      const displayHeight = Math.round(imgHeight * scale);

      stage.width(displayWidth);
      stage.height(displayHeight);

      imageNode = new Konva.Image({
        x: 0,
        y: 0,
        image: img,
        width: displayWidth,
        height: displayHeight,
      });

      layer.destroyChildren();
      layer.add(imageNode);
      layer.draw();

      initializeMaskLayer(displayWidth, displayHeight);
      updateCursorSize();

      imageInfo.innerHTML =
        `Orijinal: ${imgWidth}×${imgHeight}px<br>` +
        `Ekranda: ${displayWidth}×${displayHeight}px` +
        (scale !== 1 ? `<br>Ölçek: ${scale.toFixed(2)}` : "");
    }
  }

  uploadButton.addEventListener("click", () => fileInput.click());

  fileInput.addEventListener("change", (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => loadImage(event.target.result);
    reader.readAsDataURL(file);
  });

  clearButton.addEventListener("click", () => {
    if (!imageNode) return;
    layer.destroyChildren();
    maskLayer.destroyChildren();
    layer.draw();
    maskLayer.draw();
    stage.width(100);
    stage.height(100);
    imageInfo.innerHTML = "";
    originalImage = null;
    fileInput.value = "";
  });

  sendButton.addEventListener("click", async () => {
    if (!imageNode || !originalImage) {
      alert("Önce bir görsel seçin.");
      return;
    }

    sendButton.disabled = true;
    loadingIndicator.style.display = "inline";

    try {
      // Gönderilecek boyutu belirle (çok büyük fotoğrafları küçült)
      let submitWidth = originalImage.width;
      let submitHeight = originalImage.height;
      if (submitWidth > MAX_SUBMIT_DIMENSION || submitHeight > MAX_SUBMIT_DIMENSION) {
        const shrink = MAX_SUBMIT_DIMENSION / Math.max(submitWidth, submitHeight);
        submitWidth = Math.round(submitWidth * shrink);
        submitHeight = Math.round(submitHeight * shrink);
      }

      const originalCanvas = document.createElement("canvas");
      originalCanvas.width = submitWidth;
      originalCanvas.height = submitHeight;
      originalCanvas
        .getContext("2d")
        .drawImage(originalImage, 0, 0, submitWidth, submitHeight);
      const originalBase64 = originalCanvas.toDataURL("image/png");

      maskLayer.visible(true);
      const maskCanvas = document.createElement("canvas");
      maskCanvas.width = submitWidth;
      maskCanvas.height = submitHeight;
      const tempCanvas = maskLayer.toCanvas();
      maskCanvas
        .getContext("2d")
        .drawImage(
          tempCanvas,
          0,
          0,
          tempCanvas.width,
          tempCanvas.height,
          0,
          0,
          submitWidth,
          submitHeight
        );
      const maskBase64 = maskCanvas.toDataURL("image/png");
      maskLayer.visible(false);

      const blob = await callFluxFill({
        image: originalBase64,
        mask: maskBase64,
        prompt: promptInput.value.trim(),
        prompt_upsampling: improvePrompt.checked,
        steps: parseInt(stepsSlider.value, 10),
        guidance: parseFloat(guidanceSlider.value),
      });

      const blobUrl = URL.createObjectURL(blob);

      const modal = document.getElementById("ai-resultModal");
      const resultImageEl = document.getElementById("ai-resultImage");
      const originalImageEl = document.getElementById("ai-originalImage");
      const slider = modal.querySelector(".slider");
      const comparisonContainer = modal.querySelector(".comparison-container");

      originalImageEl.src = originalCanvas.toDataURL("image/png");
      resultImageEl.src = blobUrl;

      comparisonContainer.style.setProperty("--position", "15%");
      slider.value = 15;

      Promise.all([
        new Promise((resolve) => (originalImageEl.onload = resolve)),
        new Promise((resolve) => (resultImageEl.onload = resolve)),
      ]).then(() => {
        modal.style.display = "block";
      });

      slider.oninput = (e) => {
        comparisonContainer.style.setProperty("--position", `${e.target.value}%`);
      };

      document.getElementById("ai-reuseButton").onclick = () => {
        loadImage(blobUrl);
        modal.style.display = "none";
      };

      document.getElementById("ai-saveButton").onclick = () => {
        const link = document.createElement("a");
        link.href = blobUrl;
        link.download = "ai-gorsel.png";
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
      };

      document.getElementById("ai-closeButton").onclick = () => {
        modal.style.display = "none";
        URL.revokeObjectURL(blobUrl);
      };

      const closeOnEscape = (event) => {
        if (event.key === "Escape" && modal.style.display === "block") {
          modal.style.display = "none";
          URL.revokeObjectURL(blobUrl);
          window.removeEventListener("keydown", closeOnEscape);
        }
      };
      window.addEventListener("keydown", closeOnEscape);
    } catch (err) {
      alert("Görsel oluşturulamadı: " + err.message);
    } finally {
      sendButton.disabled = false;
      loadingIndicator.style.display = "none";
    }
  });

  function paintAt(pos) {
    maskLayer.add(new Konva.Circle({ x: pos.x, y: pos.y, radius: BRUSH_RADIUS * scale, fill: "white" }));
    maskLayer.draw();
    layer.add(
      new Konva.Circle({
        x: pos.x,
        y: pos.y,
        radius: BRUSH_RADIUS * scale,
        fill: "black",
        globalCompositeOperation: "destination-out",
      })
    );
    layer.draw();
  }

  stage.on("mousemove", (e) => {
    cursor.style.display = "block";
    cursor.style.left = e.evt.clientX + window.scrollX + "px";
    cursor.style.top = e.evt.clientY + window.scrollY + "px";
    if (isDrawing && imageNode) paintAt(stage.getPointerPosition());
  });
  stage.on("mouseout", () => (cursor.style.display = "none"));
  stage.on("mousedown", () => (isDrawing = true));
  stage.on("mouseup", () => (isDrawing = false));

  stage.on("touchstart", () => {
    isDrawing = true;
    if (imageNode) paintAt(stage.getPointerPosition());
  });
  stage.on("touchend", () => (isDrawing = false));
  stage.on("touchmove", () => {
    if (isDrawing && imageNode) paintAt(stage.getPointerPosition());
  });
}

document.addEventListener("DOMContentLoaded", initAiImageEditor);
