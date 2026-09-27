export interface ClipData {
  id: string;
  index: number;
  languageVariant: string;
  dialogue: string;
  shotType: string;
  characterId: string | null;
  sceneDescription: string;
  imagePrompt: string;
  sceneImagePath: string | null;
  emotionLabel: string;
  curiosityScore: number;
  hasHook: boolean;
  voiceTone: string;
  prompt: string;
  estimatedWords: number;
  estimatedDurationSeconds: number;
  actualDurationSeconds: number | null;
  status: string;
  attemptCount: number;
  videoPath: string | null;
  lastFramePath: string | null;
  errorMessage: string | null;
}

export interface StoryData {
  id: string;
  languageVariant: string;
  title: string;
  summary: string;
  hook: string;
  fullStory: string;
  estimatedWords: number;
  estimatedDurationSeconds: number;
  language: string;
  contentWarnings: string;
  characterVoiceNotes: string;
}

export interface CharacterData {
  id: string;
  role: string;
  name: string;
  age: number;
  adult: boolean;
  gender: string;
  nationalityLook: string;
  hair: string;
  faceFeatures: string;
  makeup: string;
  wardrobe: string;
  bodyFraming: string;
  sittingPose: string;
  gestureLevel: string;
  voiceCharacter: string;
  emotionTone: string;
  environment: string;
  lighting: string;
  cameraAngle: string;
  lensLook: string;
  background: string;
  negativePrompt: string;
  referenceImagePath: string | null;
  flowCharacterReference: string;
  baseAppearancePrompt: string;
  baseWardrobePrompt: string;
  baseEnvironmentPrompt: string;
  baseCameraPrompt: string;
  baseVoicePrompt: string;
  dnaCard: string;
  imagePrompt: string;
  imageApproved: boolean;
  styleCloset: string;
  storyRole: string;
  storyNote: string;
}

export interface JobData {
  id: string;
  type: string;
  state: string;
  mode: string;
  currentClipId: string | null;
  pausedReason: string | null;
  errorMessage: string | null;
  createdAt: string;
}

export interface ProjectData {
  id: string;
  name: string;
  slug: string;
  title: string;
  topic: string;
  genre: string;
  targetDurationSeconds: number;
  storyLanguage: string;
  speechLanguage: string;
  audience: string;
  narrationStyle: string;
  openingHook: string;
  avoidList: string;
  speechPace: string;
  targetWordCount: number;
  templateType: string;
  seriesHook: string;
  longformSettings: string;
  timeTravelSettings?: string;
  status: string;
  flowModel: string;
  flowImageModel: string;
  clipSeconds: number;
  aspectRatio: string;
  outputsPerGeneration: number;
  audioEnabled: boolean;
  useReference: boolean;
  useFlowCharacter: boolean;
  useStartFrame: boolean;
  usePrevLastFrame: boolean;
  reuseFlowProject: boolean;
  flowProjectName: string;
  flowProjectUrl: string;
  generateButtonMode: string;
  automationMode: string;
  promptTemplate: string;
  allowSubtitles: boolean;
  ageBand: string;
  moralLesson: string;
  visualStyle: string;
  channelName: string;
  episodeNumber: number;
  emotionCurve: string;
  parentProjectId: string | null;
  filmIndex: number;
  parent: { id: string; name: string; filmIndex: number } | null;
  films: Array<{ id: string; name: string; title: string; filmIndex: number; status: string }>;
  stories: StoryData[];
  characters: CharacterData[];
  clips: ClipData[];
  jobs: JobData[];
}

export interface EventData {
  id: number;
  level: string;
  step: string;
  message: string;
  detail: string | null;
  screenshotPath: string | null;
  attempt: number;
  createdAt: string;
}
