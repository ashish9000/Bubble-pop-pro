import React, { useState, useEffect, useRef, useCallback } from 'react';
import { 
  Play, 
  RotateCcw, 
  Trophy, 
  Pause, 
  Home, 
  Volume2, 
  VolumeX,
  Target,
  Sparkles,
  Info
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

// --- Types ---
type GameState = 'menu' | 'playing' | 'paused' | 'gameover' | 'levelup';
type BubbleSlot = { r: number; c: number; colorIdx: number | null };

enum PowerUp {
  NONE = 0,
  BOMB = 99,
  LIGHTNING = 98,
  STEEL = 97,
  RAINBOW = 96
}

// --- Constants ---
const COLS = 11;
const RADIUS = 18;
const DIAMETER = RADIUS * 2;
const ROW_HEIGHT = RADIUS * Math.sqrt(3);
const COLORS = [
  '#ff4757', // Red
  '#3742fa', // Blue
  '#2ed573', // Green
  '#eccc68', // Yellow
  '#ffa502', // Orange
  '#70a1ff', // Sky
];
const SHOOT_SPEED = 14;
const CEILING_DROP_COUNT = 5;

// --- Components ---

export default function BubblePopGame() {
  const [gameState, setGameState] = useState<GameState>('menu');
  const [score, setScore] = useState(0);
  const [highScore, setHighScore] = useState(() => Number(localStorage.getItem('bubble_high_score') || 0));
  const [level, setLevel] = useState(1);
  const [muted, setMuted] = useState(false);
  const [showTooltip, setShowTooltip] = useState(true);
  const [inventory, setInventory] = useState<Record<number, number>>({
    [PowerUp.BOMB]: 2,
    [PowerUp.LIGHTNING]: 2,
    [PowerUp.STEEL]: 2,
    [PowerUp.RAINBOW]: 2
  });

  const THEMES = [
    { name: 'Crystal Cave', bg: 'bg-slate-950', secondary: 'bg-blue-500/20', accent: 'text-blue-400', stroke: 'rgba(59, 130, 246, 0.4)' },
    { name: 'Emerald Grove', bg: 'bg-emerald-950', secondary: 'bg-emerald-500/20', accent: 'text-emerald-400', stroke: 'rgba(16, 185, 129, 0.4)' },
    { name: 'Solar Flare', bg: 'bg-orange-950', secondary: 'bg-orange-500/20', accent: 'text-orange-400', stroke: 'rgba(249, 115, 22, 0.4)' },
    { name: 'Deep Abyss', bg: 'bg-indigo-950', secondary: 'bg-indigo-500/20', accent: 'text-indigo-400', stroke: 'rgba(99, 102, 241, 0.4)' },
    { name: 'Cyberspace', bg: 'bg-purple-950', secondary: 'bg-purple-500/20', accent: 'text-purple-400', stroke: 'rgba(168, 85, 247, 0.4)' },
  ];

  const currentTheme = THEMES[(level - 1) % THEMES.length];

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  
  // Game internals
  const gridRef = useRef<Array<Array<number | null>>>([]);
  const currentBubbleRef = useRef<number>(0);
  const nextBubbleRef = useRef<number>(0);
  const shootingRef = useRef({ x: 0, y: 0, vx: 0, vy: 0, active: false, pierceCount: 0 });
  const aimAngleRef = useRef(-Math.PI / 2);
  const shotsWithoutPopRef = useRef(0);
  const particlesRef = useRef<Array<any>>([]);
  const dimsRef = useRef({ width: 480, height: 700 });
  const timeRef = useRef(0);
  const SHOOTER_Y_POS = 640;
  const DANGER_LINE_Y = 580;

  // --- Logic Helpers ---

  const getRandomColor = (forGrid = false) => {
    const rand = Math.random();
    // Power-ups should be rarer as level increases
    const levelFactor = Math.max(0.2, 1 - (level - 1) * 0.1);
    const threshold = (forGrid ? 0.04 : 0.008) * levelFactor; 
    
    if (rand < threshold) return PowerUp.BOMB;
    if (rand < threshold * 2) return PowerUp.LIGHTNING;
    if (rand < threshold * 3) return PowerUp.STEEL;
    if (rand < threshold * 4) return PowerUp.RAINBOW;
    
    return Math.floor(Math.random() * COLORS.length);
  };

  const getGridPos = (r: number, c: number) => {
    const x = 30 + c * DIAMETER + (r % 2) * RADIUS;
    const y = 40 + r * ROW_HEIGHT;
    return { x, y };
  };

  const initGrid = useCallback((rows: number) => {
    const newGrid: (number | null)[][] = [];
    for (let r = 0; r < rows + 10; r++) {
      newGrid[r] = new Array(COLS).fill(null);
      if (r < rows) {
        for (let c = 0; c < COLS; c++) {
          newGrid[r][c] = getRandomColor(true);
        }
      }
    }
    gridRef.current = newGrid;
  }, []);

  const [popScore, setPopScore] = useState<number | null>(null);

  const createParticles = (x: number, y: number, colorIdx: number, isScore = false, scoreVal = 0) => {
    if (isScore) {
      particlesRef.current.push({
        x, y,
        vx: 0,
        vy: -2,
        life: 1.0,
        color: '#fff',
        text: `+${scoreVal}`,
        isText: true
      });
      return;
    }
    const color = COLORS[colorIdx] || '#fff';
    for (let i = 0; i < 8; i++) {
      particlesRef.current.push({
        x, y,
        vx: (Math.random() - 0.5) * 8,
        vy: (Math.random() - 0.5) * 8,
        life: 1.0,
        color
      });
    }
  };

  const handleShoot = () => {
    if (gameState !== 'playing' || shootingRef.current.active) return;
    
    // Slight speed variation for each shot
    const speed = SHOOT_SPEED + (Math.random() - 0.5) * 1.5;
    shootingRef.current = {
      x: dimsRef.current.width / 2,
      y: dimsRef.current.height - 60,
      vx: Math.cos(aimAngleRef.current) * speed,
      vy: Math.sin(aimAngleRef.current) * speed,
      active: true,
      pierceCount: 0
    };

    if (showTooltip) setShowTooltip(false);
  };

  const checkFloating = () => {
    const visited = new Set<string>();
    const safe = new Set<string>();

    const flood = (r: number, c: number) => {
      const key = `${r},${c}`;
      if (
        r < 0 || r >= gridRef.current.length || 
        c < 0 || c >= COLS || 
        gridRef.current[r][c] === null || 
        visited.has(key)
      ) return;
      
      visited.add(key);
      safe.add(key);

      const dirs = r % 2 === 0 
        ? [[-1,-1], [-1,0], [0,-1], [0,1], [1,-1], [1,0]]
        : [[-1,0], [-1,1], [0,-1], [0,1], [1,0], [1,1]];

      for (const [dr, dc] of dirs) flood(r + dr, c + dc);
    };

    for (let c = 0; c < COLS; c++) {
      if (gridRef.current[0][c] !== null) flood(0, c);
    }

    const floating: {r: number, c: number}[] = [];
    for (let r = 0; r < gridRef.current.length; r++) {
      for (let c = 0; c < COLS; c++) {
        if (gridRef.current[r][c] !== null && !safe.has(`${r},${c}`)) {
          floating.push({ r, c });
        }
      }
    }
    return floating;
  };

  const getCluster = (r: number, c: number, color: number, visited = new Set<string>()) => {
    const key = `${r},${c}`;
    if (
      r < 0 || r >= gridRef.current.length || 
      c < 0 || c >= COLS || 
      gridRef.current[r][c] !== color || 
      visited.has(key)
    ) return [];

    visited.add(key);
    const cluster = [{ r, c }];

    const dirs = r % 2 === 0 
      ? [[-1,-1], [-1,0], [0,-1], [0,1], [1,-1], [1,0]]
      : [[-1,0], [-1,1], [0,-1], [0,1], [1,0], [1,1]];

    for (const [dr, dc] of dirs) {
      cluster.push(...getCluster(r + dr, c + dc, color, visited));
    }
    return cluster;
  };

  const handleSwap = () => {
    if (gameState !== 'playing' || shootingRef.current.active) return;
    const temp = currentBubbleRef.current;
    currentBubbleRef.current = nextBubbleRef.current;
    nextBubbleRef.current = temp;
  };

  const usePowerUp = (type: PowerUp) => {
    if (gameState !== 'playing' || shootingRef.current.active || inventory[type] <= 0) return;
    
    // Put current bubble back into next if it was a color, or just discard if it was another powerup?
    // Let's just override current.
    setInventory(prev => ({ ...prev, [type]: prev[type] - 1 }));
    currentBubbleRef.current = type;
  };

  const solveShot = (r: number, c: number, hitColorOnImpact: number | null = null) => {
    const shotType = currentBubbleRef.current;
    let popped = 0;
    const collectedPowers: number[] = [];

    const handlePop = (row: number, col: number) => {
      if (row < 0 || row >= gridRef.current.length || col < 0 || col >= COLS) return;
      const type = gridRef.current[row][col];
      if (type !== null) {
        if (type >= 90 && type !== shotType) collectedPowers.push(type);
        const p = getGridPos(row, col);
        createParticles(p.x, p.y, type);
        gridRef.current[row][col] = null;
        popped++;
      }
    };

    if (shotType === PowerUp.BOMB) {
      // PROXIMITY EXPLOSION
      const center = getGridPos(r, c);
      for (let _r = 0; _r < gridRef.current.length; _r++) {
        for (let _c = 0; _c < COLS; _c++) {
          if (gridRef.current[_r][_c] !== null) {
            const p = getGridPos(_r, _c);
            const d = Math.hypot(p.x - center.x, p.y - center.y);
            if (d < DIAMETER * 3.0) {
              handlePop(_r, _c);
            }
          }
        }
      }
      shotsWithoutPopRef.current = 0;
    } else if (shotType === PowerUp.LIGHTNING) {
      // HORIZONTAL VAPORIZATION (Clears the row it snapped into AND adjacent rows slightly)
      const targetRows = [r - 1, r, r + 1];
      targetRows.forEach(tr => {
        if (tr >= 0 && tr < gridRef.current.length) {
          for (let _c = 0; _c < COLS; _c++) {
            handlePop(tr, _c);
          }
        }
      });
      shotsWithoutPopRef.current = 0;
    } else if (shotType === PowerUp.RAINBOW) {
      // COLOR PRISM CHAIN - Use hitColorOnImpact if provided, otherwise check neighbors
      let colorToTarget = hitColorOnImpact;
      
      if (colorToTarget === null || colorToTarget >= 90) {
        // Find a neighboring colored bubble
        const dirs = r % 2 === 0 
          ? [[-1,-1], [-1,0], [0,-1], [0,1], [1,-1], [1,0]]
          : [[-1,0], [-1,1], [0,-1], [0,1], [1,0], [1,1]];
        for (const [dr, dc] of dirs) {
          const nr = r + dr;
          const nc = c + dc;
          if (nr >= 0 && nr < gridRef.current.length && nc >= 0 && nc < COLS) {
            const val = gridRef.current[nr][nc];
            if (val !== null && val < COLORS.length) {
              colorToTarget = val;
              break;
            }
          }
        }
      }

      if (colorToTarget !== null && colorToTarget < COLORS.length) {
        for (let _r = 0; _r < gridRef.current.length; _r++) {
          for (let _c = 0; _c < COLS; _c++) {
            if (gridRef.current[_r][_c] === colorToTarget) {
              handlePop(_r, _c);
            }
          }
        }
      }
      // Also pop itself if it hasn't been popped yet
      handlePop(r, c); 
      shotsWithoutPopRef.current = 0;
    } else {
      // Standard Pop
      const color = gridRef.current[r][c];
      if (color === null) return;

      const cluster = getCluster(r, c, color);
      if (cluster.length >= 3) {
        cluster.forEach(({ r, c }) => {
          handlePop(r, c);
        });
        shotsWithoutPopRef.current = 0;
      } else {
        shotsWithoutPopRef.current++;
      }
    }

    // Drop floating
    const floating = checkFloating();
    floating.forEach(({ r, c }) => {
      handlePop(r, c);
    });

    if (collectedPowers.length > 0) {
      setInventory(prev => {
        const next = { ...prev };
        collectedPowers.forEach(p => {
          if (next[p] !== undefined) next[p]++;
        });
        return next;
      });
    }

    if (popped > 0) {
      const { x, y } = getGridPos(r, c);
      createParticles(x, y, 0, true, popped * 10);
      setPopScore(popped * 10);
      setTimeout(() => setPopScore(null), 500);
    }

    setScore(s => s + popped * 10);
    
    // Check level complete
    const isEmpty = gridRef.current.every(row => row.every(cell => cell === null));
    if (isEmpty) {
      setGameState('levelup');
      setInventory({
        [PowerUp.BOMB]: 2,
        [PowerUp.LIGHTNING]: 2,
        [PowerUp.STEEL]: 2,
        [PowerUp.RAINBOW]: 2
      });
      return;
    }

    // Ceiling drop
    if (shotsWithoutPopRef.current >= CEILING_DROP_COUNT) {
      const newRow = Array.from({ length: COLS }, () => getRandomColor(true));
      gridRef.current.unshift(newRow);
      shotsWithoutPopRef.current = 0;
    }

    // Check game over (hit danger line)
    for (let _r = 0; _r < gridRef.current.length; _r++) {
      for (let _c = 0; _c < COLS; _c++) {
        if (gridRef.current[_r][_c] !== null) {
          const { y } = getGridPos(_r, _c);
          if (y > DANGER_LINE_Y) {
            setGameState('gameover');
            return;
          }
        }
      }
    }

    currentBubbleRef.current = nextBubbleRef.current;
    nextBubbleRef.current = getRandomColor();
    shootingRef.current.active = false;
  };

  // --- Game Loop ---

  useEffect(() => {
    if (gameState !== 'playing') return;

    let raf: number;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const render = () => {
      timeRef.current += 0.015;
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      // Draw Danger Line
      ctx.strokeStyle = '#ef4444';
      ctx.setLineDash([10, 5]);
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(0, DANGER_LINE_Y);
      ctx.lineTo(canvas.width, DANGER_LINE_Y);
      ctx.stroke();
      ctx.setLineDash([]);
      
      ctx.fillStyle = 'rgba(239, 68, 68, 0.05)';
      ctx.fillRect(0, DANGER_LINE_Y, canvas.width, canvas.height - DANGER_LINE_Y);

      // 1. Update Shooting
      const shoot = shootingRef.current;
      if (shoot.active) {
        shoot.x += shoot.vx;
        shoot.y += shoot.vy;

        // Bounce walls
        if (shoot.x < RADIUS || shoot.x > canvas.width - RADIUS) {
          shoot.vx *= -1;
          // Slight randomness on wall bounce
          shoot.vx += (Math.random() - 0.5) * 0.4;
          shoot.vy += (Math.random() - 0.5) * 0.2;
          shoot.x = shoot.x < RADIUS ? RADIUS : canvas.width - RADIUS;
        }

        // Check top or grid
        const dist = (x1: number, y1: number, x2: number, y2: number) => Math.hypot(x1 - x2, y1 - y2);
        
        let impactBubble = null;
        
        // Grid Collision
        for (let r = 0; r < gridRef.current.length; r++) {
          for (let c = 0; c < COLS; c++) {
            if (gridRef.current[r][c] !== null) {
              const pos = getGridPos(r, c);
              if (dist(shoot.x, shoot.y, pos.x, pos.y) < DIAMETER - 4) {
                impactBubble = { r, c };
                break;
              }
            }
          }
          if (impactBubble) break;
        }

        // Steel Piercer logic
        if (impactBubble && currentBubbleRef.current === PowerUp.STEEL) {
          createParticles(shoot.x, shoot.y, gridRef.current[impactBubble.r][impactBubble.c]!);
          gridRef.current[impactBubble.r][impactBubble.c] = null;
          shoot.pierceCount++;
          if (shoot.pierceCount >= 5) {
            shoot.active = false;
            currentBubbleRef.current = nextBubbleRef.current;
            nextBubbleRef.current = getRandomColor();
          }
        } 
        // Normal powerups or colored bubbles
        else if (impactBubble || shoot.y < 40 + RADIUS) {
          const collidedColor = impactBubble ? gridRef.current[impactBubble.r][impactBubble.c] : null;

          // Snap logic
          let bestFit = { r: 0, c: 0, dist: Infinity };
          for (let r = 0; r < gridRef.current.length; r++) {
            const offset = (r % 2) * RADIUS;
            for (let c = 0; c < COLS; c++) {
              if (gridRef.current[r][c] === null) {
                const pos = { 
                  x: 30 + c * DIAMETER + offset,
                  y: 40 + r * ROW_HEIGHT
                };
                const d = dist(shoot.x, shoot.y, pos.x, pos.y);
                if (d < bestFit.dist) bestFit = { r, c, dist: d };
              }
            }
          }
          gridRef.current[bestFit.r][bestFit.c] = currentBubbleRef.current;
          solveShot(bestFit.r, bestFit.c, collidedColor);
        }
      }

      // 2. Trajectory Preview
      if (!shoot.active) {
        ctx.setLineDash([5, 5]);
        ctx.strokeStyle = 'rgba(255,255,255,0.2)';
        ctx.beginPath();
        ctx.moveTo(canvas.width / 2, SHOOTER_Y_POS);
        ctx.lineTo(
          canvas.width / 2 + Math.cos(aimAngleRef.current) * 2000, 
          SHOOTER_Y_POS + Math.sin(aimAngleRef.current) * 2000
        );
        ctx.stroke();
        ctx.setLineDash([]);
      }

      // 3. Draw Grid
      gridRef.current.forEach((row, r) => {
        row.forEach((cell, c) => {
          if (cell !== null) {
            const { x, y } = getGridPos(r, c);
            const wobbleX = Math.sin(timeRef.current + r * 0.5 + c * 0.3) * 1.5;
            const wobbleY = Math.cos(timeRef.current * 0.8 + r * 0.3 - c * 0.5) * 1.5;
            drawBubble(ctx, x + wobbleX, y + wobbleY, cell);
          }
        });
      });

      // 4. Draw Shooting Bubble
      if (shoot.active) {
        drawBubble(ctx, shoot.x, shoot.y, currentBubbleRef.current);
      }

      // 5. Draw Shooter
      const sx = canvas.width / 2;
      const sy = SHOOTER_Y_POS;
      
      // Pivot
      ctx.save();
      ctx.translate(sx, sy);
      ctx.rotate(aimAngleRef.current);
      // Arrow/Gun style
      ctx.fillStyle = 'rgba(255,255,255,0.1)';
      ctx.fillRect(0, -10, 40, 20);
      ctx.restore();

      // Next preview
      drawBubble(ctx, sx - 40, sy + 30, nextBubbleRef.current, RADIUS * 0.7);
      // Current wait
      if (!shoot.active) {
        drawBubble(ctx, sx, sy, currentBubbleRef.current);
      }

      // 6. Particles
      particlesRef.current = particlesRef.current.filter(p => p.life > 0);
      particlesRef.current.forEach(p => {
        p.x += p.vx;
        p.y += p.vy;
        p.life -= 0.015;
        ctx.globalAlpha = p.life;
        
        if (p.isText) {
          ctx.fillStyle = p.color;
          ctx.font = 'bold 16px sans-serif';
          ctx.textAlign = 'center';
          ctx.fillText(p.text, p.x, p.y);
        } else {
          ctx.fillStyle = p.color;
          ctx.beginPath();
          ctx.arc(p.x, p.y, 2, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.globalAlpha = 1.0;
      });

      raf = requestAnimationFrame(render);
    };

    raf = requestAnimationFrame(render);
    return () => cancelAnimationFrame(raf);
  }, [gameState, level]);

  const drawBubble = (ctx: CanvasRenderingContext2D, x: number, y: number, colorIdx: number, rad = RADIUS) => {
    ctx.save();
    
    if (colorIdx === PowerUp.BOMB) {
      // Bomb: Dark with red glowing core
      const g = ctx.createRadialGradient(x, y, rad * 0.1, x, y, rad);
      g.addColorStop(0, '#ff0000');
      g.addColorStop(0.5, '#440000');
      g.addColorStop(1, '#111111');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(x, y, rad, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = '#ff4444'; ctx.lineWidth = 1; ctx.stroke();
      // Icon
      ctx.fillStyle = '#fff'; ctx.font = 'bold 12px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText('💣', x, y);
    } else if (colorIdx === PowerUp.LIGHTNING) {
      // Lightning: Yellow glow
      ctx.shadowBlur = 10; ctx.shadowColor = '#fbbf24';
      ctx.fillStyle = '#1e293b';
      ctx.beginPath(); ctx.arc(x, y, rad, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = '#fbbf24'; ctx.lineWidth = 2; ctx.stroke();
      ctx.fillStyle = '#fbbf24'; ctx.font = 'bold 12px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText('⚡', x, y);
    } else if (colorIdx === PowerUp.STEEL) {
      // Steel: Metallic grey with shine
      const g = ctx.createLinearGradient(x - rad, y - rad, x + rad, y + rad);
      g.addColorStop(0, '#e2e8f0');
      g.addColorStop(0.5, '#475569');
      g.addColorStop(1, '#1e293b');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(x, y, rad, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = '#94a3b8'; ctx.lineWidth = 1; ctx.stroke();
      ctx.fillStyle = '#fff'; ctx.font = 'bold 10px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText('STEEL', x, y);
    } else if (colorIdx === PowerUp.RAINBOW) {
      // Rainbow: Multi-color gradient
      const g = ctx.createConicGradient(0, x, y);
      g.addColorStop(0, '#ff0000');
      g.addColorStop(0.2, '#ffff00');
      g.addColorStop(0.4, '#00ff00');
      g.addColorStop(0.6, '#00ffff');
      g.addColorStop(0.8, '#0000ff');
      g.addColorStop(1, '#ff00ff');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(x, y, rad, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = '#fff'; ctx.lineWidth = 1; ctx.stroke();
      ctx.fillStyle = '#fff'; ctx.font = 'bold 12px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText('🌈', x, y);
    } else {
      const color = COLORS[colorIdx];
      // Body
      ctx.beginPath();
      ctx.arc(x, y, rad, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.fill();
      
      // Gloss/Highlight
      const gradient = ctx.createRadialGradient(x - rad * 0.3, y - rad * 0.3, rad * 0.1, x, y, rad);
      gradient.addColorStop(0, 'rgba(255,255,255,0.4)');
      gradient.addColorStop(1, 'transparent');
      ctx.fillStyle = gradient;
      ctx.beginPath();
      ctx.arc(x, y, rad, 0, Math.PI * 2);
      ctx.fill();

      // Shadow border
      ctx.strokeStyle = 'rgba(0,0,0,0.2)';
      ctx.lineWidth = 1;
      ctx.stroke();
    }
    
    ctx.restore();
  };

  // --- Handlers ---

  const handleStart = () => {
    initGrid(6);
    currentBubbleRef.current = getRandomColor();
    nextBubbleRef.current = getRandomColor();
    setScore(0);
    setLevel(1);
    shotsWithoutPopRef.current = 0;
    setInventory({
      [PowerUp.BOMB]: 2,
      [PowerUp.LIGHTNING]: 2,
      [PowerUp.STEEL]: 2,
      [PowerUp.RAINBOW]: 2
    });
    setGameState('playing');
  };

  const handleMouseMove = (e: React.MouseEvent | React.TouchEvent) => {
    if (gameState !== 'playing' || !canvasRef.current) return;
    
    const rect = canvasRef.current.getBoundingClientRect();
    let cx, cy;

    if ('touches' in e) {
      cx = e.touches[0].clientX - rect.left;
      cy = e.touches[0].clientY - rect.top;
    } else {
      cx = e.clientX - rect.left;
      cy = e.clientY - rect.top;
    }

    const sx = dimsRef.current.width / 2;
    const sy = SHOOTER_Y_POS;
    
    // Only aim upwards
    aimAngleRef.current = Math.atan2(cy - sy, cx - sx);
    if (aimAngleRef.current > -0.2) aimAngleRef.current = -0.2;
    if (aimAngleRef.current < -Math.PI + 0.2) aimAngleRef.current = -Math.PI + 0.2;
  };

  useEffect(() => {
    if (score > highScore) {
      setHighScore(score);
      localStorage.setItem('bubble_high_score', score.toString());
    }
  }, [score, highScore]);

  return (
    <div className={`min-h-screen ${currentTheme.bg} text-white overflow-hidden flex flex-col items-center justify-center p-4 transition-colors duration-1000`}>
      
      {/* Background Ambience */}
      <div className="fixed inset-0 pointer-events-none opacity-20">
        <div className={`absolute top-1/4 left-1/4 w-96 h-96 ${currentTheme.secondary} rounded-full blur-[160px]`} />
        <div className={`absolute bottom-1/4 right-1/4 w-96 h-96 ${currentTheme.secondary} rounded-full blur-[160px]`} />
      </div>

      <div className="relative z-10 w-full max-w-lg">
        
        {/* Header Stats */}
        <div className="mb-6 flex justify-between items-end px-4">
          <div>
            <h1 className="text-4xl font-black italic border-b-4 border-white/20 inline-block tracking-tighter">BUBBLE POP PRO</h1>
            <div className="mt-1 flex gap-4 text-[10px] uppercase font-bold tracking-widest text-slate-400">
              <span className="flex items-center gap-1"><Trophy size={10} className="text-yellow-400" /> Best: {highScore}</span>
              <span className={`flex items-center gap-1 font-black text-white ${currentTheme.accent}`}>Area: {currentTheme.name}</span>
              <span className="flex items-center gap-1 font-black text-white">Level: {level}</span>
            </div>
          </div>
          <div className="text-right">
            <motion.div 
              key={score}
              initial={{ scale: 1.2, color: '#fff' }}
              animate={{ scale: 1, color: currentTheme.accent.includes('blue') ? '#60a5fa' : 
                                 currentTheme.accent.includes('emerald') ? '#34d399' :
                                 currentTheme.accent.includes('orange') ? '#fb923c' :
                                 currentTheme.accent.includes('indigo') ? '#818cf8' : '#c084fc' }}
              className={`text-3xl font-black ${currentTheme.accent.replace('text-', 'text-')}`}
            >
              {score.toString().padStart(5, '0')}
            </motion.div>
            <div className="text-[10px] font-bold text-slate-500 uppercase">Current Score</div>
          </div>
        </div>

        {/* Game Stage */}
        <div 
          ref={containerRef}
          className="relative bg-black/40 backdrop-blur-sm border-4 border-white/5 rounded-[40px] shadow-2xl overflow-hidden aspect-[48/70]"
        >
          {/* Inventory Panel */}
          <div className="absolute left-6 top-1/2 -translate-y-1/2 flex flex-col gap-3 z-30">
            {[PowerUp.BOMB, PowerUp.LIGHTNING, PowerUp.STEEL, PowerUp.RAINBOW].map(type => (
              <button 
                key={type}
                onClick={() => usePowerUp(type)}
                disabled={inventory[type] <= 0}
                className={`w-12 h-12 rounded-2xl border flex items-center justify-center relative transition-all active:scale-95
                  ${inventory[type] > 0 ? 'bg-white/10 border-white/20 hover:bg-white/20 shadow-lg' : 'bg-black/40 border-white/5 opacity-50 grayscale'}`}
              >
                <span className="text-xl">
                  {type === PowerUp.BOMB && '💣'}
                  {type === PowerUp.LIGHTNING && '⚡'}
                  {type === PowerUp.STEEL && '⛓️'}
                  {type === PowerUp.RAINBOW && '🌈'}
                </span>
                {inventory[type] > 0 && (
                  <span className="absolute -top-2 -right-2 w-5 h-5 bg-blue-500 rounded-full text-[10px] font-black flex items-center justify-center border-2 border-slate-900">
                    {inventory[type]}
                  </span>
                )}
              </button>
            ))}
          </div>

          {/* Swap Button */}
          <div className="absolute bottom-8 left-1/2 -translate-x-1/2 z-30">
             <button 
              onClick={handleSwap}
              className="px-6 py-2 bg-white/10 backdrop-blur-md border border-white/10 rounded-full text-[10px] font-black uppercase tracking-widest text-white hover:bg-white/20 transition-all active:scale-95 flex items-center gap-2"
             >
               <RotateCcw size={12} className="opacity-50" /> Swap Bubble
             </button>
          </div>

          {/* Active Power-up Indicator */}
          <div className="absolute top-6 right-6 flex flex-col gap-2 pointer-events-none z-30">
            {currentBubbleRef.current >= 90 && (
              <motion.div 
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                className="bg-blue-500/20 backdrop-blur-md border border-blue-500/30 px-3 py-1 rounded-full flex items-center gap-2"
              >
                <span className="text-[10px] font-black uppercase text-blue-400">Power Loaded</span>
                <span className="text-xl">
                  {currentBubbleRef.current === PowerUp.BOMB && '💣'}
                  {currentBubbleRef.current === PowerUp.LIGHTNING && '⚡'}
                  {currentBubbleRef.current === PowerUp.STEEL && '⛓️'}
                  {currentBubbleRef.current === PowerUp.RAINBOW && '🌈'}
                </span>
              </motion.div>
            )}
          </div>

          <canvas 
            ref={canvasRef}
            width={480}
            height={700}
            className="w-full h-full cursor-crosshair"
            onMouseMove={handleMouseMove}
            onTouchMove={handleMouseMove}
            onClick={handleShoot}
            onTouchEnd={handleShoot}
          />

          {/* Overlays */}
          <AnimatePresence>
            {gameState === 'menu' && (
              <Overlay>
                <motion.div 
                  initial={{ scale: 0.8, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  className="text-center"
                >
                  <div className="w-24 h-24 rounded-full bg-blue-500 flex items-center justify-center mx-auto mb-6 shadow-lg shadow-blue-500/20">
                    <Play size={48} className="fill-white ml-2 text-white" />
                  </div>
                  <h2 className="text-5xl font-black mb-2 tracking-tight">READY?</h2>
                  <p className="text-slate-400 mb-8 max-w-xs mx-auto">Pop bubbles, earn points, and climb the ranks. How long can you survive?</p>
                  <button 
                    onClick={handleStart}
                    className="group relative px-12 py-4 bg-white text-black font-black uppercase tracking-widest rounded-full hover:scale-105 transition-transform"
                  >
                    Start Game
                  </button>
                </motion.div>
              </Overlay>
            )}

            {gameState === 'gameover' && (
              <Overlay bg="bg-red-950/90">
                <motion.div 
                  initial={{ y: 20, opacity: 0 }}
                  animate={{ y: 0, opacity: 1 }}
                  className="text-center"
                >
                  <h2 className="text-6xl font-black text-red-500 mb-2">GAME OVER</h2>
                  <p className="text-slate-400 mb-8 uppercase tracking-widest font-bold">You reached level {level}</p>
                  
                  <div className="bg-black/40 p-8 rounded-3xl mb-8 border border-white/5">
                    <div className="text-sm font-bold text-slate-500 mb-1">FINAL SCORE</div>
                    <div className="text-5xl font-black">{score}</div>
                  </div>

                  <button 
                    onClick={handleStart}
                    className="flex items-center gap-3 bg-red-500 hover:bg-red-400 text-white px-10 py-5 rounded-2xl font-black uppercase tracking-widest mx-auto transition-all active:scale-95"
                  >
                    <RotateCcw size={20} /> Try Again
                  </button>
                  
                  <button 
                    onClick={() => setGameState('menu')}
                    className="mt-6 text-sm font-bold text-slate-500 hover:text-white transition-colors"
                  >
                    Back to Menu
                  </button>
                </motion.div>
              </Overlay>
            )}

            {gameState === 'levelup' && (
              <Overlay bg="bg-emerald-950/90">
                <motion.div 
                  initial={{ scale: 0.5, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  className="text-center"
                >
                  <Sparkles size={64} className="text-yellow-400 mx-auto mb-4" />
                  <h2 className="text-6xl font-black text-emerald-400 mb-2">LEVEL {level} CLEAR</h2>
                  <p className="text-slate-300 font-medium mb-8">Speed increasing. Get ready.</p>
                  <button 
                    onClick={() => {
                      setLevel(l => l + 1);
                      initGrid(Math.min(6 + level, 10));
                      setGameState('playing');
                    }}
                    className="bg-emerald-500 hover:bg-emerald-400 text-black px-12 py-5 rounded-full font-black uppercase tracking-widest transition-all"
                  >
                    Next Level
                  </button>
                </motion.div>
              </Overlay>
            )}
          </AnimatePresence>

          {/* Simple Tooltip */}
          {gameState === 'playing' && showTooltip && (
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="absolute bottom-32 left-0 right-0 text-center pointer-events-none"
            >
              <div className="inline-flex items-center gap-2 px-4 py-2 bg-white/10 backdrop-blur-md rounded-full text-[10px] font-black uppercase tracking-widest text-white/50 border border-white/10">
                <Target size={12} /> Move to aim • Click to shoot
              </div>
            </motion.div>
          )}
        </div>

        {/* Controls / Footer */}
        <div className="mt-6 flex justify-between items-center px-4">
          <div className="flex gap-4">
            <ControlBtn onClick={() => setMuted(!muted)}>
              {muted ? <VolumeX size={18} /> : <Volume2 size={18} />}
            </ControlBtn>
            <ControlBtn onClick={() => setShowTooltip(!showTooltip)}>
              <Info size={18} />
            </ControlBtn>
          </div>
          
          <div className="flex gap-2">
            {gameState === 'playing' && (
              <button 
                onClick={() => setGameState('paused')}
                className="flex items-center gap-2 px-4 py-2 bg-white/5 border border-white/5 rounded-xl hover:bg-white/10 transition-all font-bold text-xs"
              >
                <Pause size={14} /> PAUSE
              </button>
            )}
            <button 
              onClick={() => setGameState('menu')}
              className="px-4 py-2 bg-white/5 border border-white/5 rounded-xl hover:bg-white/10 transition-all font-bold text-xs"
            >
              QUIT
            </button>
          </div>
        </div>
      </div>

      {/* Paused Modal */}
      <AnimatePresence>
        {gameState === 'paused' && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-6 bg-black/60 backdrop-blur-sm">
            <motion.div 
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              className="w-full max-w-xs bg-slate-900 border border-white/10 p-8 rounded-[40px] text-center"
            >
              <h3 className="text-3xl font-black mb-8">PAUSED</h3>
              <div className="space-y-4">
                <button 
                  onClick={() => setGameState('playing')}
                  className="w-full bg-blue-500 py-4 rounded-2xl font-black uppercase tracking-widest text-sm"
                >
                  Resume
                </button>
                <button 
                  onClick={handleStart}
                  className="w-full bg-white/10 py-4 rounded-2xl font-black uppercase tracking-widest text-sm"
                >
                  Restart
                </button>
                <button 
                  onClick={() => setGameState('menu')}
                  className="w-full text-slate-500 font-bold text-xs pt-4"
                >
                  Exit to Menu
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}

function Overlay({ children, bg = "bg-slate-950/80" }: { children: React.ReactNode, bg?: string }) {
  return (
    <motion.div 
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className={`absolute inset-0 z-40 flex items-center justify-center p-6 backdrop-blur-md ${bg}`}
    >
      {children}
    </motion.div>
  );
}

function ControlBtn({ children, onClick }: { children: React.ReactNode, onClick: () => void }) {
  return (
    <button 
      onClick={onClick}
      className="p-3 bg-white/5 border border-white/5 rounded-2xl hover:bg-white/10 transition-all text-slate-400 hover:text-white"
    >
      {children}
    </button>
  );
}
