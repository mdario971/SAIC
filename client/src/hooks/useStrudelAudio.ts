import { useState, useCallback, useRef, useEffect } from 'react';

interface UseStrudelAudioOptions {
  initialVolume?: number;
  initialBpm?: number;
}

interface UseStrudelAudioReturn {
  isPlaying: boolean;
  volume: number;
  bpm: number;
  error: string | null;
  isInitialized: boolean;
  play: (code: string) => Promise<void>;
  stop: () => void;
  pause: () => void;
  setVolume: (volume: number) => void;
  setBpm: (bpm: number) => void;
  initialize: () => Promise<void>;
}

export function useStrudelAudio(options: UseStrudelAudioOptions = {}): UseStrudelAudioReturn {
  const { initialVolume = 0.7, initialBpm = 120 } = options;
  
  const [isPlaying, setIsPlaying] = useState(false);
  const [volume, setVolumeState] = useState(initialVolume);
  const [bpm, setBpmState] = useState(initialBpm);
  const [error, setError] = useState<string | null>(null);
  const [isInitialized, setIsInitialized] = useState(false);
  
  const audioContextRef = useRef<AudioContext | null>(null);
  const gainNodeRef = useRef<GainNode | null>(null);
  const currentCodeRef = useRef<string>('');
  const scheduledNodesRef = useRef<AudioScheduledSourceNode[]>([]);
  const loopIntervalRef = useRef<number | null>(null);

  const initialize = useCallback(async () => {
    if (isInitialized) return;
    
    try {
      const AudioContextClass = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      audioContextRef.current = new AudioContextClass();
      
      gainNodeRef.current = audioContextRef.current.createGain();
      gainNodeRef.current.gain.value = volume;
      gainNodeRef.current.connect(audioContextRef.current.destination);
      
      if (audioContextRef.current.state === 'suspended') {
        await audioContextRef.current.resume();
      }
      
      setIsInitialized(true);
      setError(null);
    } catch (err) {
      setError('Failed to initialize audio. Please check browser permissions.');
      console.error('Audio initialization error:', err);
    }
  }, [isInitialized, volume]);

  const stopAllNodes = useCallback(() => {
    scheduledNodesRef.current.forEach(node => {
      try {
        node.stop();
        node.disconnect();
      } catch {
        // Node may already be stopped
      }
    });
    scheduledNodesRef.current = [];
  }, []);

  const parseNote = (note: string): number => {
    const noteMap: Record<string, number> = {
      'c': 0, 'd': 2, 'e': 4, 'f': 5, 'g': 7, 'a': 9, 'b': 11
    };
    
    const match = note.toLowerCase().match(/([a-g])([#b]?)(\d+)?/);
    if (!match) return 440;
    
    const [, noteName, modifier, octaveStr] = match;
    let semitone = noteMap[noteName] || 0;
    if (modifier === '#') semitone += 1;
    if (modifier === 'b') semitone -= 1;
    
    const octave = parseInt(octaveStr || '4');
    return 440 * Math.pow(2, (semitone - 9 + (octave - 4) * 12) / 12);
  };

  const createNoise = (ctx: AudioContext, duration: number): AudioBufferSourceNode => {
    const bufferSize = ctx.sampleRate * duration;
    const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      data[i] = Math.random() * 2 - 1;
    }
    const noise = ctx.createBufferSource();
    noise.buffer = buffer;
    return noise;
  };

  const playKick = useCallback((time: number) => {
    const ctx = audioContextRef.current;
    const master = gainNodeRef.current;
    if (!ctx || !master) return;

    const osc = ctx.createOscillator();
    const oscGain = ctx.createGain();
    
    osc.type = 'sine';
    osc.frequency.setValueAtTime(150, time);
    osc.frequency.exponentialRampToValueAtTime(30, time + 0.15);
    
    oscGain.gain.setValueAtTime(1, time);
    oscGain.gain.exponentialRampToValueAtTime(0.001, time + 0.3);
    
    osc.connect(oscGain);
    oscGain.connect(master);
    
    osc.start(time);
    osc.stop(time + 0.3);
    scheduledNodesRef.current.push(osc);

    const click = ctx.createOscillator();
    const clickGain = ctx.createGain();
    click.type = 'sine';
    click.frequency.setValueAtTime(1000, time);
    click.frequency.exponentialRampToValueAtTime(100, time + 0.02);
    clickGain.gain.setValueAtTime(0.5, time);
    clickGain.gain.exponentialRampToValueAtTime(0.001, time + 0.02);
    click.connect(clickGain);
    clickGain.connect(master);
    click.start(time);
    click.stop(time + 0.05);
    scheduledNodesRef.current.push(click);
  }, []);

  const playSnare = useCallback((time: number) => {
    const ctx = audioContextRef.current;
    const master = gainNodeRef.current;
    if (!ctx || !master) return;

    const noise = createNoise(ctx, 0.2);
    const noiseFilter = ctx.createBiquadFilter();
    const noiseGain = ctx.createGain();
    
    noiseFilter.type = 'highpass';
    noiseFilter.frequency.value = 1000;
    
    noiseGain.gain.setValueAtTime(0.8, time);
    noiseGain.gain.exponentialRampToValueAtTime(0.001, time + 0.2);
    
    noise.connect(noiseFilter);
    noiseFilter.connect(noiseGain);
    noiseGain.connect(master);
    
    noise.start(time);
    noise.stop(time + 0.2);
    scheduledNodesRef.current.push(noise);

    const body = ctx.createOscillator();
    const bodyGain = ctx.createGain();
    body.type = 'triangle';
    body.frequency.value = 180;
    bodyGain.gain.setValueAtTime(0.5, time);
    bodyGain.gain.exponentialRampToValueAtTime(0.001, time + 0.1);
    body.connect(bodyGain);
    bodyGain.connect(master);
    body.start(time);
    body.stop(time + 0.1);
    scheduledNodesRef.current.push(body);
  }, []);

  const playHihat = useCallback((time: number, open: boolean = false) => {
    const ctx = audioContextRef.current;
    const master = gainNodeRef.current;
    if (!ctx || !master) return;

    const duration = open ? 0.3 : 0.08;
    const noise = createNoise(ctx, duration);
    const filter = ctx.createBiquadFilter();
    const hiGain = ctx.createGain();
    
    filter.type = 'highpass';
    filter.frequency.value = 7000;
    
    hiGain.gain.setValueAtTime(0.3, time);
    hiGain.gain.exponentialRampToValueAtTime(0.001, time + duration);
    
    noise.connect(filter);
    filter.connect(hiGain);
    hiGain.connect(master);
    
    noise.start(time);
    noise.stop(time + duration);
    scheduledNodesRef.current.push(noise);
  }, []);

  const playClap = useCallback((time: number) => {
    const ctx = audioContextRef.current;
    const master = gainNodeRef.current;
    if (!ctx || !master) return;

    for (let i = 0; i < 3; i++) {
      const noise = createNoise(ctx, 0.15);
      const filter = ctx.createBiquadFilter();
      const clapGain = ctx.createGain();
      
      filter.type = 'bandpass';
      filter.frequency.value = 1200;
      filter.Q.value = 0.5;
      
      const offset = i * 0.01;
      clapGain.gain.setValueAtTime(0, time + offset);
      clapGain.gain.linearRampToValueAtTime(0.5, time + offset + 0.005);
      clapGain.gain.exponentialRampToValueAtTime(0.001, time + offset + 0.15);
      
      noise.connect(filter);
      filter.connect(clapGain);
      clapGain.connect(master);
      
      noise.start(time + offset);
      noise.stop(time + offset + 0.15);
      scheduledNodesRef.current.push(noise);
    }
  }, []);

  const playNote = useCallback((freq: number, time: number, duration: number) => {
    const ctx = audioContextRef.current;
    const master = gainNodeRef.current;
    if (!ctx || !master) return;

    const osc = ctx.createOscillator();
    const noteGain = ctx.createGain();
    const filter = ctx.createBiquadFilter();
    
    osc.type = 'sawtooth';
    osc.frequency.value = freq;
    
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(2000, time);
    filter.frequency.exponentialRampToValueAtTime(500, time + duration * 0.8);
    
    noteGain.gain.setValueAtTime(0, time);
    noteGain.gain.linearRampToValueAtTime(0.3, time + 0.01);
    noteGain.gain.setValueAtTime(0.3, time + duration * 0.7);
    noteGain.gain.exponentialRampToValueAtTime(0.001, time + duration);
    
    osc.connect(filter);
    filter.connect(noteGain);
    noteGain.connect(master);
    
    osc.start(time);
    osc.stop(time + duration);
    scheduledNodesRef.current.push(osc);
  }, []);

  const playSimplePattern = useCallback((code: string) => {
    const ctx = audioContextRef.current;
    if (!ctx) return;

    stopAllNodes();
    
    const noteMatch = code.match(/note\s*\(\s*["']([^"']+)["']\s*\)/);
    const soundMatch = code.match(/s\s*\(\s*["']([^"']+)["']\s*\)|sound\s*\(\s*["']([^"']+)["']\s*\)/);
    
    const beatDuration = 60 / bpm;
    const currentTime = ctx.currentTime;
    
    if (noteMatch) {
      const notes = noteMatch[1].split(/\s+/).filter(n => n && n !== '~');
      notes.forEach((note, index) => {
        if (note === '~') return;
        const freq = parseNote(note);
        playNote(freq, currentTime + index * beatDuration, beatDuration * 0.9);
      });
    } else if (soundMatch) {
      const sounds = (soundMatch[1] || soundMatch[2]).split(/\s+/).filter(s => s);
      sounds.forEach((sound, index) => {
        const time = currentTime + index * beatDuration;
        if (sound === '~') return;
        
        switch (sound.toLowerCase()) {
          case 'bd':
          case 'kick':
            playKick(time);
            break;
          case 'sd':
          case 'snare':
            playSnare(time);
            break;
          case 'hh':
          case 'ch':
            playHihat(time, false);
            break;
          case 'oh':
            playHihat(time, true);
            break;
          case 'cp':
          case 'clap':
            playClap(time);
            break;
          default:
            playKick(time);
        }
      });
    }
  }, [bpm, stopAllNodes, playKick, playSnare, playHihat, playClap, playNote]);

  const play = useCallback(async (code: string): Promise<void> => {
    setError(null);
    currentCodeRef.current = code;
    
    try {
      if (!isInitialized) {
        await initialize();
      }
      
      if (!code.trim()) {
        setError('No code to play');
        return Promise.resolve();
      }
      
      if (audioContextRef.current?.state === 'suspended') {
        await audioContextRef.current.resume();
      }
      
      if (loopIntervalRef.current) {
        clearInterval(loopIntervalRef.current);
      }
      
      const noteMatch = code.match(/note\s*\(\s*["']([^"']+)["']\s*\)/);
      const soundMatch = code.match(/s\s*\(\s*["']([^"']+)["']\s*\)|sound\s*\(\s*["']([^"']+)["']\s*\)/);
      
      let patternLength = 4;
      if (noteMatch) {
        patternLength = noteMatch[1].split(/\s+/).filter(n => n).length;
      } else if (soundMatch) {
        patternLength = (soundMatch[1] || soundMatch[2]).split(/\s+/).filter(s => s).length;
      }
      
      const loopDuration = (60 / bpm) * patternLength * 1000;
      
      playSimplePattern(code);
      
      loopIntervalRef.current = window.setInterval(() => {
        if (currentCodeRef.current) {
          playSimplePattern(currentCodeRef.current);
        }
      }, loopDuration);
      
      setIsPlaying(true);
      return Promise.resolve();
    } catch (err) {
      setError('Error playing audio. Check your code syntax.');
      console.error('Playback error:', err);
      return Promise.reject(err);
    }
  }, [isInitialized, initialize, playSimplePattern, bpm]);

  const stop = useCallback(() => {
    if (loopIntervalRef.current) {
      clearInterval(loopIntervalRef.current);
      loopIntervalRef.current = null;
    }
    stopAllNodes();
    currentCodeRef.current = '';
    setIsPlaying(false);
  }, [stopAllNodes]);

  const pause = useCallback(() => {
    if (loopIntervalRef.current) {
      clearInterval(loopIntervalRef.current);
      loopIntervalRef.current = null;
    }
    if (audioContextRef.current?.state === 'running') {
      audioContextRef.current.suspend();
    }
    setIsPlaying(false);
  }, []);

  const setVolume = useCallback((newVolume: number) => {
    const clampedVolume = Math.max(0, Math.min(1, newVolume));
    setVolumeState(clampedVolume);
    
    if (gainNodeRef.current) {
      gainNodeRef.current.gain.value = clampedVolume;
    }
  }, []);

  const setBpm = useCallback((newBpm: number) => {
    const clampedBpm = Math.max(60, Math.min(200, newBpm));
    setBpmState(clampedBpm);
  }, []);

  useEffect(() => {
    return () => {
      if (loopIntervalRef.current) {
        clearInterval(loopIntervalRef.current);
      }
      stopAllNodes();
      if (audioContextRef.current) {
        audioContextRef.current.close();
      }
    };
  }, [stopAllNodes]);

  return {
    isPlaying,
    volume,
    bpm,
    error,
    isInitialized,
    play,
    stop,
    pause,
    setVolume,
    setBpm,
    initialize,
  };
}
