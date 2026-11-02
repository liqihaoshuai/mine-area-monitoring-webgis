import L from 'leaflet';

/**
 * 变化检测用的「图片瓦片层」。
 *
 * 为什么不用 L.imageOverlay：
 *   一张 2112×1967 的 RGBA 图片挂上去，缩放时 Leaflet 只能靠 CSS transform 整体放大这张位图，
 *   在 2K/4K 屏上每一帧都要重新栅格化整张大图，动画会拖到 400~500ms，看起来就是
 *   「松手 0.5 秒后图层才跳到正确大小」。而矿区查看等模块用的是 GeoServer 瓦片，
 *   走的 GridLayer 通道，256px 小图各自做变换，缩放始终跟手。
 *
 * 这里把同一张 PNG 切成 256px 的画布瓦片来渲染，走的就是 GridLayer 那条路，
 * 手感和其它模块完全一致；同时保留「按矿区、按百分比裁切」的卷帘能力
 * （裁剪只改每个瓦片的 clip-path，不重绘，拖动分割线时不闪）。
 */
const ChangeImageLayer = L.GridLayer.extend({
  options: {
    pane: 'overlayPane',
    opacity: 1,
    className: 'change-overlay-tile',
    // 缩放动画期间沿用旧瓦片（只做变换），动画结束再按新级别重画，
    // 避免动画中途插进画布绘制造成掉帧
    updateWhenZooming: false,
    updateWhenIdle: false,
    keepBuffer: 1,
    // 卷帘：0 = 整幅显示，0.5 = 只显示右侧一半
    clipStart: 0,
    hasClip: false,
  },

  initialize(url, bounds, options) {
    L.setOptions(this, options);
    this._url = url;
    this._bounds = L.latLngBounds(bounds);
    this._source = null;
    this._sourceLoading = false;
  },

  onAdd(map) {
    this._loadSource();
    L.GridLayer.prototype.onAdd.call(this, map);
  },

  onRemove(map) {
    L.GridLayer.prototype.onRemove.call(this, map);
  },

  // 图层被移除时可能还有一次排队的缩放/视图更新，此时 this._map 已是 null，
  // Leaflet 原生的 _updateLevels 会直接读 map.project 而报错，这里统一兜住
  _animateZoom(event) {
    if (!this._map) return;
    L.GridLayer.prototype._animateZoom.call(this, event);
  },

  _setView(center, zoom, noPrune, noUpdate) {
    if (!this._map) return;
    L.GridLayer.prototype._setView.call(this, center, zoom, noPrune, noUpdate);
  },

  _resetView(center, zoom) {
    if (!this._map) return;
    L.GridLayer.prototype._resetView.call(this, center, zoom);
  },

  _updateLevels() {
    if (!this._map) return undefined;
    return L.GridLayer.prototype._updateLevels.call(this);
  },

  /** 底图只加载一次，之后各缩放级别都从这张原图裁切 */
  _loadSource() {
    if (this._source || this._sourceLoading) return;
    this._sourceLoading = true;
    const img = new Image();
    img.decoding = 'async';
    img.onload = () => {
      this._sourceLoading = false;
      this._source = img;
      this.redraw();
      this.fire('load');
    };
    img.onerror = () => {
      this._sourceLoading = false;
      this.fire('error');
    };
    img.src = this._url;
  },

  createTile(coords, done) {
    const canvas = document.createElement('canvas');
    const size = this.getTileSize();
    canvas.width = size.x;
    canvas.height = size.y;
    this._drawTile(canvas, coords, size);
    // 同步回调即可：瓦片内容是当场画好的，没有网络等待
    if (done) setTimeout(() => done(null, canvas), 0);
    return canvas;
  },

  _drawTile(canvas, coords, size) {
    const img = this._source;
    const map = this._map;
    if (!img || !map || !map.project) return;

    // 图片四角在该缩放级别下的世界像素坐标（与 GridLayer 的瓦片坐标系一致）
    const nw = map.project(this._bounds.getNorthWest(), coords.z);
    const se = map.project(this._bounds.getSouthEast(), coords.z);
    const imgW = se.x - nw.x;
    const imgH = se.y - nw.y;
    if (imgW <= 0 || imgH <= 0) return;

    const tileLeft = coords.x * size.x;
    const tileTop = coords.y * size.y;
    const dx0 = Math.max(tileLeft, nw.x);
    const dx1 = Math.min(tileLeft + size.x, se.x);
    const dy0 = Math.max(tileTop, nw.y);
    const dy1 = Math.min(tileTop + size.y, se.y);
    if (dx1 <= dx0 || dy1 <= dy0) return;   // 这块瓦片完全在矿区外

    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(
      img,
      (dx0 - nw.x) / imgW * img.width,
      (dy0 - nw.y) / imgH * img.height,
      (dx1 - dx0) / imgW * img.width,
      (dy1 - dy0) / imgH * img.height,
      dx0 - tileLeft, dy0 - tileTop, dx1 - dx0, dy1 - dy0
    );

    // 记录图片在这块瓦片里的横向位置，卷帘时按像素裁，不用重绘
    canvas._clipInfo = {
      imgLeft: nw.x - tileLeft,
      imgWidth: imgW,
      tileWidth: size.x,
    };
    this._applyTileClip(canvas);
  },

  _applyTileClip(canvas) {
    if (!canvas || !canvas._clipInfo) return;
    const info = canvas._clipInfo;
    const start = this.options.hasClip ? this.options.clipStart : 0;
    if (start <= 0) {
      canvas.style.clipPath = '';
      canvas.style.webkitClipPath = '';
      return;
    }
    const cut = Math.max(0, Math.min(info.tileWidth, info.imgLeft + info.imgWidth * start));
    const clip = `inset(0 0 0 ${cut.toFixed(2)}px)`;
    canvas.style.clipPath = clip;
    canvas.style.webkitClipPath = clip;
  },

  /** 卷帘分割线变化：只改裁剪，不重建瓦片，所以拖动时不闪 */
  setClip(fraction) {
    const value = Math.max(0, Math.min(1, Number(fraction) || 0));
    if (this.options.clipStart === value) return this;
    this.options.clipStart = value;
    const tiles = this._tiles || {};
    Object.keys(tiles).forEach(key => this._applyTileClip(tiles[key].el));
    return this;
  },
});

export function changeImageLayer(url, bounds, options) {
  return new ChangeImageLayer(url, bounds, options);
}
