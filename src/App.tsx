/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  Pause, 
  Play, 
  RotateCcw, 
  ArrowDown, 
  ArrowLeft, 
  ArrowRight, 
  ArrowUp,
  Trophy,
  Gamepad2,
  Mic,
  MicOff,
  Loader2
} from 'lucide-react';
import { GoogleGenAI, Modality, Type, FunctionDeclaration } from "@google/genai";

// --- Constants ---
const COLS = 10;
const ROWS = 20;
const INITIAL_SPEED = 800;
const MIN_SPEED = 100;
const SPEED_INCREMENT = 50;

type Point = { x: number; y: number };
type PieceType = 'I' | 'J' | 'L' | 'O' | 'S' | 'T' | 'Z';

interface Piece {
  pos: Point;
  shape: number[][];
  color: string;
  type: PieceType;
}

const SHAPES: Record<PieceType, number[][]> = {
  I: [[0, 0, 0, 0], [1, 1, 1, 1], [0, 0, 0, 0], [0, 0, 0, 0]],
  J: [[1, 0, 0], [1, 1, 1], [0, 0, 0]],
  L: [[0, 0, 1], [1, 1, 1], [0, 0, 0]],
  O: [[1, 1], [1, 1]],
  S: [[0, 1, 1], [1, 1, 0], [0, 0, 0]],
  T: [[0, 1, 0], [1, 1, 1], [0, 0, 0]],
  Z: [[1, 1, 0], [0, 1, 1], [0, 0, 0]],
};

const COLORS: Record<PieceType, string> = {
  I: 'bg-cyan-400 shadow-[0_0_15px_rgba(34,211,238,0.6)]',
  J: 'bg-blue-500 shadow-[0_0_15px_rgba(59,130,246,0.6)]',
  L: 'bg-orange-500 shadow-[0_0_15px_rgba(249,115,22,0.6)]',
  O: 'bg-yellow-400 shadow-[0_0_15px_rgba(250,204,21,0.6)]',
  S: 'bg-green-500 shadow-[0_0_15px_rgba(34,197,94,0.6)]',
  T: 'bg-purple-500 shadow-[0_0_15px_rgba(168,85,247,0.6)]',
  Z: 'bg-red-500 shadow-[0_0_15px_rgba(239,68,68,0.6)]',
};

// --- Helper Functions ---
const createEmptyGrid = () => Array.from({ length: ROWS }, () => Array(COLS).fill(0));

const getRandomPiece = (): Piece => {
  const types: PieceType[] = ['I', 'J', 'L', 'O', 'S', 'T', 'Z'];
  const type = types[Math.floor(Math.random() * types.length)];
  return {
    pos: { x: Math.floor(COLS / 2) - Math.floor(SHAPES[type][0].length / 2), y: 0 },
    shape: SHAPES[type],
    color: COLORS[type],
    type,
  };
};

export default function App() {
  const [grid, setGrid] = useState<(string | number)[][]>(createEmptyGrid());
  const [activePiece, setActivePiece] = useState<Piece | null>(null);
  const [nextPiece, setNextPiece] = useState<Piece>(getRandomPiece());
  const [score, setScore] = useState(0);
  const [level, setLevel] = useState(1);
  const [lines, setLines] = useState(0);
  const [gameOver, setGameOver] = useState(false);
  const [paused, setPaused] = useState(false);
  const [highScore, setHighScore] = useState(0);
  
  // Voice Control State
  const [isVoiceActive, setIsVoiceActive] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [audioLevel, setAudioLevel] = useState(0);
  const [lastTranscription, setLastTranscription] = useState("");
  const sessionRef = useRef<any>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const gameLoopRef = useRef<number | null>(null);
  const lastTimeRef = useRef<number>(0);
  const dropCounterRef = useRef<number>(0);

  // Load high score
  useEffect(() => {
    const saved = localStorage.getItem('tetris-high-score');
    if (saved) setHighScore(parseInt(saved, 10));
  }, []);

  // Save high score
  useEffect(() => {
    if (score > highScore) {
      setHighScore(score);
      localStorage.setItem('tetris-high-score', score.toString());
    }
  }, [score, highScore]);

  const isValidMove = useCallback((piece: Piece, newPos: Point, newShape?: number[][]) => {
    const shape = newShape || piece.shape;
    for (let y = 0; y < shape.length; y++) {
      for (let x = 0; x < shape[y].length; x++) {
        if (shape[y][x]) {
          const newX = newPos.x + x;
          const newY = newPos.y + y;
          if (
            newX < 0 || 
            newX >= COLS || 
            newY >= ROWS || 
            (newY >= 0 && grid[newY][newX] !== 0)
          ) {
            return false;
          }
        }
      }
    }
    return true;
  }, [grid]);

  const rotate = (matrix: number[][]) => {
    return matrix[0].map((_, index) => matrix.map(col => col[index]).reverse());
  };

  const clearLines = useCallback((newGrid: (string | number)[][]) => {
    let linesCleared = 0;
    const filteredGrid = newGrid.filter(row => row.some(cell => cell === 0));
    linesCleared = ROWS - filteredGrid.length;
    
    if (linesCleared > 0) {
      const emptyRows = Array.from({ length: linesCleared }, () => Array(COLS).fill(0));
      const updatedGrid = [...emptyRows, ...filteredGrid];
      setGrid(updatedGrid);
      setLines(prev => prev + linesCleared);
      setScore(prev => prev + (linesCleared * 100 * level));
      
      if (Math.floor((lines + linesCleared) / 10) > Math.floor(lines / 10)) {
        setLevel(prev => prev + 1);
      }
    } else {
      setGrid(newGrid);
    }
  }, [lines, level]);

  const lockPiece = useCallback(() => {
    if (!activePiece) return;
    const newGrid = grid.map(row => [...row]);
    activePiece.shape.forEach((row, y) => {
      row.forEach((value, x) => {
        if (value) {
          const gridY = activePiece.pos.y + y;
          const gridX = activePiece.pos.x + x;
          if (gridY >= 0) {
            newGrid[gridY][gridX] = activePiece.color;
          }
        }
      });
    });

    clearLines(newGrid);
    
    const next = nextPiece;
    if (!isValidMove(next, next.pos)) {
      setGameOver(true);
      setActivePiece(null);
    } else {
      setActivePiece(next);
      setNextPiece(getRandomPiece());
    }
  }, [activePiece, grid, nextPiece, clearLines, isValidMove]);

  const moveDown = useCallback(() => {
    if (!activePiece || gameOver || paused) return;
    const newPos = { ...activePiece.pos, y: activePiece.pos.y + 1 };
    if (isValidMove(activePiece, newPos)) {
      setActivePiece({ ...activePiece, pos: newPos });
    } else {
      lockPiece();
    }
  }, [activePiece, gameOver, paused, lockPiece, isValidMove]);

  const moveLeft = useCallback(() => {
    if (!activePiece || gameOver || paused) return;
    const newPos = { ...activePiece.pos, x: activePiece.pos.x - 1 };
    if (isValidMove(activePiece, newPos)) {
      setActivePiece({ ...activePiece, pos: newPos });
    }
  }, [activePiece, gameOver, paused, isValidMove]);

  const moveRight = useCallback(() => {
    if (!activePiece || gameOver || paused) return;
    const newPos = { ...activePiece.pos, x: activePiece.pos.x + 1 };
    if (isValidMove(activePiece, newPos)) {
      setActivePiece({ ...activePiece, pos: newPos });
    }
  }, [activePiece, gameOver, paused, isValidMove]);

  const rotatePiece = useCallback(() => {
    if (!activePiece || gameOver || paused) return;
    const newShape = rotate(activePiece.shape);
    if (isValidMove(activePiece, activePiece.pos, newShape)) {
      setActivePiece({ ...activePiece, shape: newShape });
    }
  }, [activePiece, gameOver, paused, isValidMove]);

  const hardDrop = useCallback(() => {
    if (!activePiece || gameOver || paused) return;
    let newY = activePiece.pos.y;
    while (isValidMove(activePiece, { ...activePiece.pos, y: newY + 1 })) {
      newY++;
    }
    
    const finalPiece = { ...activePiece, pos: { ...activePiece.pos, y: newY } };
    
    const newGrid = grid.map(row => [...row]);
    finalPiece.shape.forEach((row, y) => {
      row.forEach((value, x) => {
        if (value) {
          const gridY = finalPiece.pos.y + y;
          const gridX = finalPiece.pos.x + x;
          if (gridY >= 0) {
            newGrid[gridY][gridX] = finalPiece.color;
          }
        }
      });
    });
    clearLines(newGrid);
    const next = nextPiece;
    if (!isValidMove(next, next.pos)) {
      setGameOver(true);
      setActivePiece(null);
    } else {
      setActivePiece(next);
      setNextPiece(getRandomPiece());
    }
  }, [activePiece, grid, nextPiece, clearLines, isValidMove]);

  const controlsRef = useRef({
    moveLeft,
    moveRight,
    rotatePiece,
    moveDown,
    hardDrop
  });

  useEffect(() => {
    controlsRef.current = {
      moveLeft,
      moveRight,
      rotatePiece,
      moveDown,
      hardDrop
    };
  }, [moveLeft, moveRight, rotatePiece, moveDown, hardDrop]);

  const resetGame = () => {
    setGrid(createEmptyGrid());
    setActivePiece(getRandomPiece());
    setNextPiece(getRandomPiece());
    setScore(0);
    setLevel(1);
    setLines(0);
    setGameOver(false);
    setPaused(false);
  };

  // --- Voice Control Logic ---
  const stopVoice = useCallback(() => {
    if (sessionRef.current) {
      sessionRef.current.close();
      sessionRef.current = null;
    }
    if (processorRef.current) {
      processorRef.current.disconnect();
      processorRef.current = null;
    }
    if (audioContextRef.current) {
      audioContextRef.current.close();
      audioContextRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }
    setIsVoiceActive(false);
    setIsConnecting(false);
    setAudioLevel(0);
    setLastTranscription("");
  }, []);

  const startVoice = async () => {
    if (isVoiceActive || isConnecting) return;
    setIsConnecting(true);

    try {
      const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
      
      const moveLeftDecl: FunctionDeclaration = {
        name: "move_left",
        description: "Move the current Tetris piece one column to the left.",
        parameters: { type: Type.OBJECT, properties: {} }
      };
      const moveRightDecl: FunctionDeclaration = {
        name: "move_right",
        description: "Move the current Tetris piece one column to the right.",
        parameters: { type: Type.OBJECT, properties: {} }
      };
      const rotateDecl: FunctionDeclaration = {
        name: "rotate",
        description: "Rotate the current Tetris piece 90 degrees clockwise.",
        parameters: { type: Type.OBJECT, properties: {} }
      };
      const dropDecl: FunctionDeclaration = {
        name: "drop",
        description: "Move the current Tetris piece one row down (soft drop).",
        parameters: { type: Type.OBJECT, properties: {} }
      };
      const hardDropDecl: FunctionDeclaration = {
        name: "hard_drop",
        description: "Instantly drop the current Tetris piece to the bottom.",
        parameters: { type: Type.OBJECT, properties: {} }
      };

      const sessionPromise = ai.live.connect({
        model: "gemini-2.5-flash-native-audio-preview-12-2025",
        config: {
          responseModalities: [Modality.AUDIO],
          systemInstruction: "Tetris controller. Support English and Kyrgyz. Hear 'left'/'сол'->move_left, 'right'/'оң'->move_right, 'rotate'/'айлант'->rotate, 'down'/'drop'/'түшүр'/'ылдый'->drop, 'hard drop'/'тез түшүр'->hard_drop. Call tools IMMEDIATELY. No speech. Speed is priority.",
          tools: [{ functionDeclarations: [moveLeftDecl, moveRightDecl, rotateDecl, dropDecl, hardDropDecl] }],
          inputAudioTranscription: {},
        },
        callbacks: {
          onopen: () => {
            setIsVoiceActive(true);
            setIsConnecting(false);
            sessionPromise.then(s => setupAudio(s));
          },
          onmessage: async (message) => {
            // Handle transcription
            if (message.serverContent?.inputTranscription?.text) {
              setLastTranscription(message.serverContent.inputTranscription.text);
            }

            // Handle tool calls (function calls)
            const functionCalls = message.toolCall?.functionCalls;
            if (functionCalls) {
              for (const fc of functionCalls) {
                const { name, id } = fc;
                console.log("Tool call received:", name);
                
                const controls = controlsRef.current;
                if (name === "move_left") controls.moveLeft();
                else if (name === "move_right") controls.moveRight();
                else if (name === "rotate") controls.rotatePiece();
                else if (name === "drop") controls.moveDown();
                else if (name === "hard_drop") controls.hardDrop();

                // Send response back
                sessionPromise.then(s => s.sendToolResponse({
                  functionResponses: [{
                    name,
                    response: { result: "ok" },
                    id
                  }]
                }));
              }
            }

            // Also check modelTurn parts for function calls (fallback)
            if (message.serverContent?.modelTurn?.parts) {
              for (const part of message.serverContent.modelTurn.parts) {
                if (part.functionCall) {
                  const { name, id } = part.functionCall;
                  console.log("Part function call received:", name);
                  
                  const controls = controlsRef.current;
                  if (name === "move_left") controls.moveLeft();
                  else if (name === "move_right") controls.moveRight();
                  else if (name === "rotate") controls.rotatePiece();
                  else if (name === "drop") controls.moveDown();
                  else if (name === "hard_drop") controls.hardDrop();

                  sessionPromise.then(s => s.sendToolResponse({
                    functionResponses: [{
                      name,
                      response: { result: "ok" },
                      id
                    }]
                  }));
                }
              }
            }
          },
          onclose: () => stopVoice(),
          onerror: (err) => {
            console.error("Voice error:", err);
            stopVoice();
          }
        }
      });

      const session = await sessionPromise;
      sessionRef.current = session;
    } catch (err) {
      console.error("Failed to start voice:", err);
      setIsConnecting(false);
    }
  };

  const setupAudio = async (session: any) => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      
      const audioContext = new AudioContext({ sampleRate: 16000 });
      if (audioContext.state === 'suspended') {
        await audioContext.resume();
      }
      audioContextRef.current = audioContext;
      
      const source = audioContext.createMediaStreamSource(stream);
      const processor = audioContext.createScriptProcessor(1024, 1, 1);
      processorRef.current = processor;

      processor.onaudioprocess = (e) => {
        if (!sessionRef.current) return;
        
        const inputData = e.inputBuffer.getChannelData(0);
        
        // Calculate audio level for visualization
        let sum = 0;
        for (let i = 0; i < inputData.length; i++) {
          sum += inputData[i] * inputData[i];
        }
        setAudioLevel(Math.sqrt(sum / inputData.length));

        // Convert Float32 to Int16
        const pcmData = new Int16Array(inputData.length);
        for (let i = 0; i < inputData.length; i++) {
          pcmData[i] = Math.max(-1, Math.min(1, inputData[i])) * 0x7FFF;
        }
        
        // Safer Base64 conversion
        const bytes = new Uint8Array(pcmData.buffer);
        let binary = '';
        for (let i = 0; i < bytes.byteLength; i++) {
          binary += String.fromCharCode(bytes[i]);
        }
        const base64Data = btoa(binary);

        session.sendRealtimeInput({
          media: { data: base64Data, mimeType: 'audio/pcm;rate=16000' }
        });
      };

      source.connect(processor);
      processor.connect(audioContext.destination);
    } catch (err) {
      console.error("Audio setup failed:", err);
      stopVoice();
    }
  };

  useEffect(() => {
    return () => stopVoice();
  }, [stopVoice]);

  // Keyboard controls
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (gameOver) return;
      
      switch (e.key) {
        case 'ArrowLeft': moveLeft(); break;
        case 'ArrowRight': moveRight(); break;
        case 'ArrowDown': moveDown(); break;
        case 'ArrowUp': rotatePiece(); break;
        case ' ': hardDrop(); break;
        case 'p': setPaused(prev => !prev); break;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [activePiece, gameOver, paused, moveDown]);

  // Game loop
  useEffect(() => {
    const update = (time: number) => {
      if (gameOver || paused) {
        gameLoopRef.current = requestAnimationFrame(update);
        return;
      }

      const deltaTime = time - lastTimeRef.current;
      lastTimeRef.current = time;
      dropCounterRef.current += deltaTime;

      const speed = Math.max(MIN_SPEED, INITIAL_SPEED - (level - 1) * SPEED_INCREMENT);

      if (dropCounterRef.current > speed) {
        moveDown();
        dropCounterRef.current = 0;
      }

      gameLoopRef.current = requestAnimationFrame(update);
    };

    gameLoopRef.current = requestAnimationFrame(update);
    return () => {
      if (gameLoopRef.current) cancelAnimationFrame(gameLoopRef.current);
    };
  }, [moveDown, gameOver, paused, level]);

  // Initial piece
  useEffect(() => {
    if (!activePiece && !gameOver) {
      setActivePiece(getRandomPiece());
    }
  }, []);

  return (
    <div className="min-h-screen bg-[#0a0a0c] text-white font-sans selection:bg-cyan-500/30 flex flex-col items-center justify-center p-4 overflow-hidden">
      {/* Background Glow */}
      <div className="fixed inset-0 pointer-events-none">
        <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] bg-purple-900/20 blur-[120px] rounded-full" />
        <div className="absolute bottom-[-10%] right-[-10%] w-[40%] h-[40%] bg-blue-900/20 blur-[120px] rounded-full" />
      </div>

      <div className="relative z-10 w-full max-w-5xl grid grid-cols-[1fr_auto] lg:grid-cols-[1fr_auto_1fr] gap-4 md:gap-8 items-center justify-center">
        
        {/* Left Panel: Stats (Desktop only) */}
        <div className="hidden lg:flex flex-col gap-4">
          <StatCard label="SCORE" value={score} icon={<Trophy className="w-4 h-4 text-yellow-400" />} />
          <StatCard label="LEVEL" value={level} />
          <StatCard label="LINES" value={lines} />
          <StatCard label="HIGH SCORE" value={highScore} color="text-cyan-400" />
        </div>

        {/* Center: Game Board */}
        <div className="relative group">
          <div className="absolute -inset-1 bg-gradient-to-b from-cyan-500/20 to-purple-500/20 rounded-xl blur opacity-75 group-hover:opacity-100 transition duration-1000 group-hover:duration-200"></div>
          <div className="relative bg-[#121214] border border-white/10 rounded-xl p-1 md:p-2 shadow-2xl">
            <div 
              className="grid gap-[1px] bg-white/5 border border-white/5 overflow-hidden"
              style={{ 
                gridTemplateColumns: `repeat(${COLS}, 1fr)`,
                width: 'min(70vw, 300px)',
                aspectRatio: `${COLS}/${ROWS}`,
                height: 'auto'
              }}
            >
              {grid.flat().map((cell, index) => {
                const x = index % COLS;
                const y = Math.floor(index / COLS);
                let colorClass = 'bg-transparent';

                // Check if active piece is here
                if (activePiece) {
                  const pieceY = y - activePiece.pos.y;
                  const pieceX = x - activePiece.pos.x;
                  if (
                    pieceY >= 0 && pieceY < activePiece.shape.length &&
                    pieceX >= 0 && pieceX < activePiece.shape[0].length &&
                    activePiece.shape[pieceY][pieceX]
                  ) {
                    colorClass = activePiece.color;
                  }
                }

                // If not active piece, check grid
                if (cell !== 0) {
                  colorClass = cell as string;
                }

                return (
                  <div 
                    key={`${x}-${y}`} 
                    className={`w-full h-full rounded-[1px] transition-all duration-150 ${colorClass}`}
                  />
                );
              })}
            </div>

            {/* Overlays */}
            <AnimatePresence>
              {(gameOver || paused) && (
                <motion.div 
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="absolute inset-0 z-20 flex flex-col items-center justify-center bg-black/80 backdrop-blur-sm rounded-xl"
                >
                  {gameOver ? (
                    <div className="text-center space-y-6">
                      <h2 className="text-4xl font-black tracking-tighter text-red-500 italic">GAME OVER</h2>
                      <div className="space-y-1">
                        <p className="text-white/50 text-xs uppercase tracking-widest">Final Score</p>
                        <p className="text-3xl font-mono">{score}</p>
                      </div>
                      <button 
                        onClick={resetGame}
                        className="px-8 py-3 bg-white text-black font-bold rounded-full hover:scale-105 transition-transform flex items-center gap-2 mx-auto"
                      >
                        <RotateCcw className="w-4 h-4" /> TRY AGAIN
                      </button>
                    </div>
                  ) : (
                    <div className="text-center space-y-6">
                      <h2 className="text-4xl font-black tracking-tighter text-cyan-400 italic">PAUSED</h2>
                      <button 
                        onClick={() => setPaused(false)}
                        className="px-8 py-3 bg-cyan-500 text-white font-bold rounded-full hover:scale-105 transition-transform flex items-center gap-2 mx-auto"
                      >
                        <Play className="w-4 h-4 fill-current" /> RESUME
                      </button>
                    </div>
                  )}
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>

        {/* Right Panel: Next Piece & Mobile Controls */}
        <div className="flex flex-col gap-4 md:gap-6 max-w-[140px] md:max-w-none">
          {/* Next Piece */}
          <div className="bg-[#121214] border border-white/10 rounded-xl p-2 md:p-4 space-y-2 md:space-y-4">
            <p className="text-[8px] md:text-[10px] font-bold tracking-[0.2em] text-white/40 uppercase">Next</p>
            <div className="grid grid-cols-4 grid-rows-4 gap-0.5 md:gap-1 w-12 h-12 md:w-24 md:h-24 mx-auto">
              {Array.from({ length: 4 }).map((_, y) => 
                Array.from({ length: 4 }).map((_, x) => {
                  let color = 'bg-white/5';
                  if (nextPiece) {
                    const py = y;
                    const px = x;
                    if (
                      py < nextPiece.shape.length &&
                      px < nextPiece.shape[0].length &&
                      nextPiece.shape[py][px]
                    ) {
                      color = nextPiece.color;
                    }
                  }
                  return <div key={`${x}-${y}`} className={`w-full h-full rounded-[1px] ${color}`} />;
                })
              )}
            </div>
          </div>

          {/* Mobile Stats (Visible on small screens) */}
          <div className="lg:hidden flex flex-col gap-2">
            <StatCard label="SCORE" value={score} compact />
            <StatCard label="LEVEL" value={level} compact />
          </div>

          {/* Controls Help / Mobile Buttons */}
          <div className="space-y-4">
            <div className="hidden lg:block text-[10px] font-mono text-white/30 space-y-1">
              <p>ARROWS: MOVE & ROTATE</p>
              <p>SPACE: HARD DROP</p>
              <p>P: PAUSE</p>
            </div>

            {/* Mobile Controls */}
            <div className="grid grid-cols-3 gap-1.5 md:gap-2 lg:hidden">
              <div />
              <ControlButton onClick={rotatePiece} icon={<ArrowUp />} size="small" />
              <div />
              <ControlButton onClick={moveLeft} icon={<ArrowLeft />} size="small" />
              <ControlButton onClick={moveDown} icon={<ArrowDown />} size="small" />
              <ControlButton onClick={moveRight} icon={<ArrowRight />} size="small" />
              <div />
              <ControlButton onClick={hardDrop} icon={<ArrowDown className="scale-y-150" />} size="small" className="bg-white/20" />
              <div />
            </div>
            
            <button 
              onClick={() => setPaused(prev => !prev)}
              className="w-full py-2 md:py-3 border border-white/10 rounded-xl hover:bg-white/5 transition-colors flex items-center justify-center gap-2 text-[10px] font-bold tracking-widest lg:hidden"
            >
              {paused ? <Play className="w-3 h-3 fill-current" /> : <Pause className="w-3 h-3 fill-current" />}
            </button>

            {/* Voice Control Button & Level Meter */}
            <div className="space-y-2">
              <button 
                onClick={isVoiceActive ? stopVoice : startVoice}
                disabled={isConnecting}
                className={`w-full py-3 rounded-xl border transition-all flex items-center justify-center gap-2 text-[10px] font-bold tracking-widest ${
                  isVoiceActive 
                    ? 'bg-red-500/20 border-red-500/50 text-red-400' 
                    : 'bg-cyan-500/10 border-cyan-500/30 text-cyan-400 hover:bg-cyan-500/20'
                } ${isConnecting ? 'opacity-50 cursor-not-allowed' : ''}`}
              >
                {isConnecting ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : isVoiceActive ? (
                  <Mic className="w-4 h-4" />
                ) : (
                  <MicOff className="w-4 h-4" />
                )}
                {isConnecting ? 'CONNECTING...' : isVoiceActive ? 'VOICE ON' : 'VOICE CONTROL'}
              </button>
              
              {isVoiceActive && (
                <div className="space-y-2">
                  <div className="h-1 w-full bg-white/5 rounded-full overflow-hidden">
                    <motion.div 
                      initial={{ width: 0 }}
                      animate={{ width: `${Math.min(100, audioLevel * 500)}%` }}
                      className="h-full bg-cyan-400 shadow-[0_0_10px_rgba(34,211,238,0.8)]"
                    />
                  </div>
                  {lastTranscription && (
                    <motion.p 
                      initial={{ opacity: 0, y: 5 }}
                      animate={{ opacity: 1, y: 0 }}
                      className="text-[9px] font-mono text-cyan-400/70 text-center uppercase tracking-wider line-clamp-1"
                    >
                      "{lastTranscription}"
                    </motion.p>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Footer */}
      <footer className="mt-12 text-[10px] font-mono text-white/20 tracking-widest uppercase flex items-center gap-4">
        <span>NEON TETRIS v1.0</span>
        <span className="w-1 h-1 bg-white/20 rounded-full" />
        <span>STAY FOCUSED</span>
      </footer>
    </div>
  );
}

function StatCard({ label, value, icon, color = "text-white", compact = false }: { label: string, value: number | string, icon?: React.ReactNode, color?: string, compact?: boolean }) {
  return (
    <div className={`bg-[#121214] border border-white/10 rounded-xl ${compact ? 'p-3' : 'p-5'} flex flex-col gap-1`}>
      <div className="flex items-center gap-2">
        {icon}
        <p className="text-[10px] font-bold tracking-[0.2em] text-white/40 uppercase">{label}</p>
      </div>
      <p className={`${compact ? 'text-xl' : 'text-3xl'} font-mono ${color} tracking-tighter`}>{value}</p>
    </div>
  );
}

function ControlButton({ onClick, icon, className = "", size = "normal" }: { onClick: () => void, icon: React.ReactNode, className?: string, size?: "normal" | "small" }) {
  const sizeClasses = size === "small" ? "w-10 h-10" : "w-12 h-12";
  return (
    <button 
      onClick={onClick}
      className={`${sizeClasses} flex items-center justify-center bg-white/10 border border-white/10 rounded-xl active:scale-90 transition-transform ${className}`}
    >
      {React.cloneElement(icon as React.ReactElement, { className: size === "small" ? "w-4 h-4" : "w-5 h-5" })}
    </button>
  );
}
