import { useRef, useEffect, useState } from "react";

export function AudioManager(): null {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [, setIsPlaying] = useState<boolean>(false);
  const [hasInteracted, setHasInteracted] = useState<boolean>(false);
  const [audioUnavailable, setAudioUnavailable] = useState<boolean>(false);

  useEffect(() => {
    if (audioUnavailable) return;

    // Create background music audio element
    const audio = new Audio("/shot.mp3");
    audio.loop = true;
    audio.volume = 0.12;
    audio.onerror = () => {
      setAudioUnavailable(true);
    };
    audioRef.current = audio;

    // Try to play background music immediately (will fail without user interaction)
    const tryAutoPlay = async (): Promise<void> => {
      try {
        await audio.play();
        setIsPlaying(true);
      } catch {
        // Ignore autoplay errors; browsers require user gesture.
      }
    };

    tryAutoPlay();

    // Listen for any user interaction to enable audio
    const handleInteraction = async (): Promise<void> => {
      if (!hasInteracted) {
        setHasInteracted(true);
        try {
          await audio.play();
          setIsPlaying(true);
        } catch {
          // Ignore playback errors to avoid noisy console logs.
        }
      }
    };

    // Add event listeners for user interaction
    document.addEventListener("click", handleInteraction);
    document.addEventListener("keydown", handleInteraction);
    document.addEventListener("touchstart", handleInteraction);

    return () => {
      document.removeEventListener("click", handleInteraction);
      document.removeEventListener("keydown", handleInteraction);
      document.removeEventListener("touchstart", handleInteraction);
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current = null;
      }
    };
  }, [hasInteracted, audioUnavailable]);

  // Audio manager runs silently with no UI
  return null;
}
