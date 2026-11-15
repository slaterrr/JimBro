// Do not let rep counts or a second CV event replace an unfinished instruction.
export function createCvNarrator(voice) {
  let instruction = null;
  const say = (text, options = {}) => {
    if (instruction) return false;
    const token = {};
    instruction = token;
    const finish = () => { if (instruction === token) instruction = null; };
    const accepted = voice.say(text, {
      ...options,
      onDone: () => { finish(); options.onDone?.(); },
      onStopped: () => { finish(); options.onStopped?.(); },
      onError: (error) => { finish(); options.onError?.(error); },
    });
    if (!accepted) finish();
    return accepted;
  };
  return {
    ...voice,
    say,
    cue: (text, options = {}) => instruction ? false : voice.cue(text, options),
    stop: () => { instruction = null; voice.stop(); },
  };
}
