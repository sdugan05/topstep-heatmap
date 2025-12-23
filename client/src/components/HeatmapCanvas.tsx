/**
 * Heatmap Canvas Component
 * 
 * Renders the rolling market data visualization using HTML5 Canvas 2D API.
 * 
 * Performance Strategy:
 * 1. Offscreen Buffering: The heatmap is generated on a small offscreen canvas (1px per column/tick)
 *    using direct pixel manipulation (ImageData). This avoids thousands of expensive fillRect calls.
 * 2. Scaling: The offscreen image is drawn onto the main canvas using `drawImage` with `imageSmoothingEnabled=false`
 *    to preserve the "blocky" retro look and ensure performance.
 * 3. Layering: Vector elements (Trade bubbles, Bid/Ask lines) are drawn on top of the heatmap image.
 * 4. RequestAnimationFrame: Rendering happens in a loop synchronized with the display refresh rate.
 */

import React, { useEffect, useRef, useState } from 'react';
import { HeatmapColumn } from '../types';

interface HeatmapCanvasProps {
  data: HeatmapColumn[]; // Ring buffer of data columns
  tickSize: number;      // Price increment (e.g., 0.25)
}

export const HeatmapCanvas: React.FC<HeatmapCanvasProps> = ({ data, tickSize }) => {
  // Main Canvas (Visible to user)
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  
  // Offscreen Canvas (Hidden buffer for heatmap generation)
  const memCanvasRef = useRef<HTMLCanvasElement>(document.createElement('canvas'));
  
  // Camera State: Stores the vertical center of the view (in Tick units)
  const smoothedCenterRef = useRef<number | null>(null);

  // -- Zoom State --
  const [pxPerTick, setPxPerTick] = useState(3); // Price Zoom (Vertical pixels per tick)
  const [colWidth, setColWidth] = useState(4);   // Time Zoom (Horizontal pixels per column)
  
  // Accumulator for smooth scrolling (Wheel delta can be small/noisy)
  const zoomAcc = useRef(0);

  // -- Interaction State --
  const isDraggingRef = useRef<{ axis: 'price' | 'time' | null, startX: number, startY: number, startVal: number }>({ axis: null, startX: 0, startY: 0, startVal: 0 });

  // -- Event Handlers --
  const handleMouseDown = (e: React.MouseEvent) => {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const width = rect.width;
    const height = rect.height;

    // Hit Test Axes
    // Price Axis: Right 50px
    // Time Axis: Bottom 30px
    if (x > width - 50) {
      isDraggingRef.current = { axis: 'price', startX: e.clientX, startY: e.clientY, startVal: pxPerTick };
    } else if (y > height - 30) {
      isDraggingRef.current = { axis: 'time', startX: e.clientX, startY: e.clientY, startVal: colWidth };
    }
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!isDraggingRef.current.axis) return;
    
    const drag = isDraggingRef.current;
    
    if (drag.axis === 'price') {
      // Dragging Price Axis (Vertical)
      // Drag Down -> Zoom Out (Smaller pxPerTick)
      // Drag Up -> Zoom In (Larger pxPerTick)
      const deltaY = e.clientY - drag.startY; // positive = down
      const sensitivity = 0.05; 
      const next = drag.startVal - deltaY * sensitivity;
      setPxPerTick(Math.max(1, Math.min(20, next)));
    } else if (drag.axis === 'time') {
      // Dragging Time Axis (Horizontal)
      // Drag Right -> Zoom In (Wider Cols), Drag Left -> Zoom Out
      const deltaX = e.clientX - drag.startX; // positive = right
      const sensitivity = 0.1;
      const next = drag.startVal + deltaX * sensitivity;
      setColWidth(Math.max(1, Math.min(50, next)));
    }
  };

  const handleMouseUp = () => {
    isDraggingRef.current = { axis: null, startX: 0, startY: 0, startVal: 0 };
  };

  const handleWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    
    // Accumulate delta
    zoomAcc.current += e.deltaY;
    
    // Threshold to trigger a zoom step (e.g., 100 units of scroll)
    const threshold = 100;
    
    if (Math.abs(zoomAcc.current) < threshold) return;
    
    // Determine direction and consume accumulator
    const direction = Math.sign(zoomAcc.current);
    zoomAcc.current = 0; // Reset
    
    if (e.shiftKey) {
      // Time Zoom
      setColWidth(prev => {
        const next = prev - direction;
        return Math.max(1, Math.min(50, next)); 
      });
    } else {
      // Price Zoom
      setPxPerTick(prev => {
        const next = prev - direction;
        return Math.max(1, Math.min(20, next));
      });
    }
  };

  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    let animationFrameId: number;

    const render = () => {
      // -- 1. Resize Handling --
      // Ensure canvas resolution matches display size 1:1 to prevent blurring
      if (canvas.width !== container.clientWidth || canvas.height !== container.clientHeight) {
        canvas.width = container.clientWidth;
        canvas.height = container.clientHeight;
      }

      // Get Context (Alpha false optimizes compositing performance)
      const ctx = canvas.getContext('2d', { alpha: false }); 
      if (!ctx) return;

      const width = canvas.width;
      const height = canvas.height;

      // Layout: Reserve 30px at bottom for Time Axis
      const chartHeight = height - 30;

      // Clear Background
      ctx.fillStyle = '#111';
      ctx.fillRect(0, 0, width, height);

      if (data.length === 0) {
        // Draw empty axes
        ctx.fillStyle = '#222';
        ctx.fillRect(width - 50, 0, 50, chartHeight); // Price Axis
        ctx.fillRect(0, chartHeight, width, 30); // Time Axis
        animationFrameId = requestAnimationFrame(render);
        return;
      }

      // -- 2. Viewport & Camera Logic --
      
      const latest = data[data.length - 1];
      const targetCenter = latest.midTick;
      
      // Initialize Camera or Snap if too far (prevents endless scrolling animation from 0)
      if (smoothedCenterRef.current === null || Math.abs(targetCenter - smoothedCenterRef.current) > 500) {
        smoothedCenterRef.current = targetCenter;
      } else {
        // Camera Smoothing (Optional):
        // Currently disabled (snap instantly) for maximum stability based on user feedback.
        // To enable smoothing, use: smoothedCenterRef.current += (targetCenter - smoothedCenterRef.current) * 0.05;
        smoothedCenterRef.current = targetCenter;
      }
      
      const centerTick = smoothedCenterRef.current!;
      
      // Calculate how many ticks fit on screen vertically using CURRENT ZOOM
      const visibleTicks = Math.ceil(chartHeight / pxPerTick);
      
      // -- Coordinate System --
      // We anchor the 'centerTick' exactly to the vertical center of the screen (height / 2).
      // Higher Prices (Tick > Center) -> Drawn above center (Y < height/2)
      // Lower Prices (Tick < Center) -> Drawn below center (Y > height/2)
      
      const centerY = chartHeight / 2;
      
      // Y-Coordinate Mapper
      const getY = (tick: number) => centerY - (tick - centerTick) * pxPerTick;
      
      // X-Coordinate Mapper (Right-aligned) using CURRENT ZOOM
      const getX = (index: number) => (width - 50) - (data.length - index) * colWidth;

      // -- 7. Debug Overlay (Top Left) --
      // Shows internal state for debugging view stability
      ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
      ctx.fillRect(0, 0, 200, 120); 
      ctx.fillStyle = '#0f0';
      ctx.font = '12px monospace';
      ctx.fillText(`MidTick: ${targetCenter}`, 10, 20);
      ctx.fillText(`Smooth:  ${centerTick.toFixed(1)}`, 10, 35);
      ctx.fillText(`CenterY: ${centerY.toFixed(0)}`, 10, 50);
      ctx.fillText(`Ticks:   ${data.length}`, 10, 65);
      ctx.fillText(`Price:   ${(targetCenter * tickSize).toFixed(2)}`, 10, 80);
      ctx.fillText(`Zoom P/T:${pxPerTick.toFixed(1)}/${colWidth.toFixed(1)}`, 10, 95);

      // -- 3. Draw Heatmap (Optimized) --
      
      // Resize offscreen buffer if needed (Height changes with zoom!)
      const memCanvas = memCanvasRef.current;
      if (memCanvas.width !== data.length || memCanvas.height !== visibleTicks) {
        memCanvas.width = data.length;
        memCanvas.height = visibleTicks;
      }
      const memCtx = memCanvas.getContext('2d');
      if (memCtx) {
        const imgData = memCtx.createImageData(data.length, visibleTicks);
        const pixels = imgData.data;

        // Image Mapping Logic:
        // TopTick corresponds to Y=0.
        // 0 = centerY - (TopTick - CenterTick) * px
        // TopTick = CenterTick + centerY / px
        const topTick = Math.floor(centerTick + centerY / pxPerTick);

        // Find max volume in recent history for Log Scaling of colors
        let maxVol = 10;
        for (let i = Math.max(0, data.length - 50); i < data.length; i++) {
          for (const v of data[i].bids) maxVol = Math.max(maxVol, v);
          for (const v of data[i].asks) maxVol = Math.max(maxVol, v);
        }
        const logMax = Math.log1p(maxVol);

        // Pixel Generation Loop
        for (let i = 0; i < data.length; i++) {
          const col = data[i];
          // Bids and Asks arrays are centered around col.midTick
          const startTick = col.midTick - Math.floor(col.bids.length / 2);
          
          // Render Bids (Green)
          for (let j = 0; j < col.bids.length; j++) {
            const vol = col.bids[j];
            if (vol > 0) {
              const tick = startTick + j;
              // Map Price Tick -> Image Row
              const row = topTick - tick;
              
              if (row >= 0 && row < visibleTicks) {
                const idx = (row * data.length + i) * 4;
                // Calculate Intensity (Logarithmic Scale)
                const intensity = Math.min(1, Math.log1p(vol) / logMax);
                // Set Pixel: R=0, G=255, B=0, A=Intensity
                pixels[idx] = 0; pixels[idx + 1] = 255; pixels[idx + 2] = 0; pixels[idx + 3] = Math.floor(intensity * 255);
              }
            }
          }

          // Render Asks (Red)
          for (let j = 0; j < col.asks.length; j++) {
            const vol = col.asks[j];
            if (vol > 0) {
              const tick = startTick + j;
              const row = topTick - tick;
              
              if (row >= 0 && row < visibleTicks) {
                const idx = (row * data.length + i) * 4;
                const intensity = Math.min(1, Math.log1p(vol) / logMax);
                // Set Pixel: R=255, G=0, B=0, A=Intensity
                pixels[idx] = 255; pixels[idx + 1] = 0; pixels[idx + 2] = 0; pixels[idx + 3] = Math.floor(intensity * 255);
              }
            }
          }
        }
        
        // Put generated pixels onto offscreen canvas
        memCtx.putImageData(imgData, 0, 0);

        // Draw offscreen canvas onto main canvas, scaling vertically by pxPerTick
        ctx.imageSmoothingEnabled = false; // Nearest-neighbor scaling for sharp edges
        const drawW = data.length * colWidth;
        const chartW = width - 50;
        const drawX = chartW - drawW;
        // The source image height corresponds to 'visibleTicks'.
        // We draw it to fill 'visibleTicks * pxPerTick' pixels on the destination.
        ctx.drawImage(memCanvas, drawX, 0, drawW, visibleTicks * pxPerTick);
      }

      // -- 4. Draw Trades (Bubbles) --
      data.forEach((col, i) => {
        const x = getX(i) + colWidth / 2;
        if (x < 0 || x > width - 50) return; // Skip offscreen
        if (col.trades.length === 0) return;

        col.trades.forEach(trade => {
          const y = getY(trade.priceTick); 
          // Skip vertical offscreen
          if (y < -10 || y > chartHeight + 10) return;

          // Radius based on volume
          const r = Math.min(10, Math.sqrt(trade.volume) * 2);
          
          ctx.beginPath();
          ctx.arc(x, y, r, 0, Math.PI * 2);
          
          // Color based on side
          if (trade.side === 'Buy') ctx.fillStyle = 'rgba(0, 255, 255, 0.8)'; // Cyan (Buy)
          else if (trade.side === 'Sell') ctx.fillStyle = 'rgba(255, 0, 255, 0.8)'; // Magenta (Sell)
          else ctx.fillStyle = 'white';
          
          ctx.fill();
          ctx.strokeStyle = 'white';
          ctx.lineWidth = 0.5;
          ctx.stroke();
        });
      });

      // -- 5. Draw Best Bid/Ask Lines --
      ctx.lineWidth = 2; // Thicker lines for visibility
      
      // Draw Best Bid (Green - Support)
      ctx.beginPath();
      ctx.strokeStyle = '#00ff00';
      let first = true;
      data.forEach((col, i) => {
        // Find highest index with volume in bids array
        let bestBidIdx = -1;
        for (let j = col.bids.length - 1; j >= 0; j--) {
          if (col.bids[j] > 0) {
            bestBidIdx = j;
            break;
          }
        }
        
        if (bestBidIdx !== -1) {
          const startTick = col.midTick - Math.floor(col.bids.length / 2);
          const tick = startTick + bestBidIdx;
          const x = getX(i) + colWidth/2;
          if (x < 0 || x > width - 50) return;
          
          // Draw at top edge of the cell (-pxPerTick/2 offset from center)
          const y = getY(tick) - pxPerTick/2; 
          if (first) { ctx.moveTo(x, y); first = false; }
          else ctx.lineTo(x, y);
        }
      });
      ctx.stroke();

      // Draw Best Ask (Red - Resistance)
      ctx.beginPath();
      ctx.strokeStyle = '#ff0000';
      first = true;
      data.forEach((col, i) => {
        // Find lowest index with volume in asks array
        let bestAskIdx = -1;
        for (let j = 0; j < col.asks.length; j++) {
          if (col.asks[j] > 0) {
            bestAskIdx = j;
            break;
          }
        }
        
        if (bestAskIdx !== -1) {
          const startTick = col.midTick - Math.floor(col.asks.length / 2);
          const tick = startTick + bestAskIdx;
          const x = getX(i) + colWidth/2;
          if (x < 0 || x > width - 50) return;

          // Draw at bottom edge of the cell (+pxPerTick/2 offset from center)
          const y = getY(tick) + pxPerTick/2; 
          if (first) { ctx.moveTo(x, y); first = false; }
          else ctx.lineTo(x, y);
        }
      });
      ctx.stroke();
      
      // -- 5.5 Current Mid Price Line (White Dashed) --
      if (data.length > 0) {
        const last = data[data.length - 1];
        const y = getY(last.midTick);
        ctx.beginPath();
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.5)';
        ctx.setLineDash([5, 5]);
        ctx.lineWidth = 1;
        ctx.moveTo(0, y);
        ctx.lineTo(width - 50, y);
        ctx.stroke();
        ctx.setLineDash([]);
      }

      // -- 6. Price Axis (Right side) --
      const axisX = width - 50;
      // Draw background
      ctx.fillStyle = '#222';
      ctx.fillRect(axisX, 0, 50, height); 
      ctx.fillStyle = 'white';
      ctx.font = '10px monospace';
      
      // Draw Separator
      ctx.beginPath();
      ctx.strokeStyle = '#444';
      ctx.moveTo(axisX, 0);
      ctx.lineTo(axisX, chartHeight);
      ctx.stroke();
      
      // Determine visible tick range
      const maxVisibleTick = Math.ceil(centerTick + centerY / pxPerTick);
      const minVisibleTick = Math.floor(centerTick - centerY / pxPerTick);
      
      // Draw labels every 5 ticks
      for (let t = minVisibleTick; t <= maxVisibleTick; t += 5) { 
        const y = getY(t);
        if (y > 0 && y < chartHeight) {
          const price = t * tickSize;
          ctx.fillText(price.toFixed(2), axisX + 5, y + 4);
          // Light grid line
          ctx.strokeStyle = 'rgba(255,255,255,0.1)';
          ctx.beginPath();
          ctx.moveTo(0, y);
          ctx.lineTo(axisX, y);
          ctx.stroke();
        }
      }

      // -- 8. Time Axis (Bottom) --
      const axisY = chartHeight;
      ctx.fillStyle = '#222';
      ctx.fillRect(0, axisY, width, 30);
      ctx.fillStyle = 'white';
      
      // Draw Separator
      ctx.beginPath();
      ctx.strokeStyle = '#444';
      ctx.moveTo(0, axisY);
      ctx.lineTo(width - 50, axisY);
      ctx.stroke();
      
      // Draw Time Labels
      // We iterate backwards from latest data
      // Label every N pixels
      const labelSpacingPx = 100;
      const colsPerLabel = Math.ceil(labelSpacingPx / colWidth);
      
      for (let i = data.length - 1; i >= 0; i -= colsPerLabel) {
        const x = getX(i) + colWidth / 2;
        if (x < 0) break; // Offscreen left
        if (x > width - 50) continue; // Skip if under Price Axis
        
        const timestamp = data[i].t;
        const date = new Date(timestamp);
        const timeStr = date.toLocaleTimeString([], { hour12: false, hour: '2-digit', minute:'2-digit', second:'2-digit' });
        
        ctx.fillText(timeStr, x - 20, axisY + 18);
        
        // Grid Line
        ctx.strokeStyle = 'rgba(255,255,255,0.1)';
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, axisY);
        ctx.stroke();
      }

      animationFrameId = requestAnimationFrame(render);
    };

    render();

    return () => cancelAnimationFrame(animationFrameId);
  }, [data, tickSize, pxPerTick, colWidth]); // Re-bind when zoom changes

  return (
    // Container overflow:hidden is crucial to prevent "infinite growth" loops with canvas
    <div 
      ref={containerRef} 
      onWheel={handleWheel} 
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseUp}
      style={{ 
        width: '100%', 
        height: '100%', 
        overflow: 'hidden',
        cursor: isDraggingRef.current?.axis ? (isDraggingRef.current.axis === 'price' ? 'ns-resize' : 'ew-resize') : 'default'
      }}
    >
      <canvas ref={canvasRef} style={{ display: 'block', width: '100%', height: '100%' }} />
    </div>
  );
};
