export function extractDominantColor(imgUrl: string): Promise<[number, number, number]> {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      try {
        const canvas = document.createElement("canvas");
        canvas.width = 40;
        canvas.height = 40;
        const ctx = canvas.getContext("2d");
        if (!ctx) { resolve([80, 80, 80]); return; }
        ctx.drawImage(img, 0, 0, 40, 40);
        const { data } = ctx.getImageData(0, 0, 40, 40);
        let r = 0, g = 0, b = 0, count = 0;
        for (let i = 0; i < data.length; i += 16) {
          r += data[i]; g += data[i + 1]; b += data[i + 2]; count++;
        }
        if (count > 0) resolve([Math.round(r / count), Math.round(g / count), Math.round(b / count)]);
        else resolve([80, 80, 80]);
      } catch { resolve([80, 80, 80]); }
    };
    img.onerror = () => resolve([80, 80, 80]);
    img.src = imgUrl;
  });
}
