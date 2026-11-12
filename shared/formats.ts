import type { SetId } from './types.ts'

/** A story format: structure and patterns only, never another creator's script or footage. */
export interface Format {
  id: string
  name: string
  hookPattern: string
  shape: string
  bridgePattern: string
  example: string
  bestSet: SetId
  mood: 'upbeat' | 'curious' | 'chill'
}

export const FORMATS: Format[] = [
  {
    id: 'what-if',
    name: 'What If',
    hookPattern: 'What if [rule of the world] changed tomorrow?',
    shape: 'Escalating consequences, then one exception',
    bridgePattern: 'The exception is the product user',
    example: 'What if every essay you ever wrote got re-scanned on graduation day?',
    bestSet: 'campus',
    mood: 'curious',
  },
  {
    id: 'true-story',
    name: 'True Story Twist',
    hookPattern: 'This person was [impossible fact].',
    shape: 'Real event told in 4 beats, payoff withheld',
    bridgePattern: "The story's lesson is the product's promise",
    example: 'In 1892 an 11-year-old was put on trial for a story she did not know she had copied.',
    bestSet: 'neutral',
    mood: 'curious',
  },
  {
    id: 'pov-skit',
    name: 'POV Skit',
    hookPattern: 'POV: [relatable situation]',
    shape: 'Comedy escalation between 2 or 3 characters',
    bridgePattern: 'The punchline needs the product',
    example: 'POV: your essay is due in 3 hours',
    bestSet: 'home',
    mood: 'upbeat',
  },
  {
    id: 'countdown',
    name: 'Day in the Life / Countdown',
    hookPattern: 'Day [N] of [challenge]',
    shape: 'Episodic, recurring cast, cliffhanger',
    bridgePattern: "The product is the character's secret weapon",
    example: 'Day 3 of writing my thesis without AI slop',
    bestSet: 'home',
    mood: 'upbeat',
  },
  {
    id: 'expectation-reality',
    name: 'Expectation vs Reality',
    hookPattern: "What they think vs what it's really like",
    shape: 'Two-column contrast',
    bridgePattern: 'The product closes the gap',
    example: 'What profs think vs what students write',
    bestSet: 'office',
    mood: 'upbeat',
  },
  {
    id: 'myth-busting',
    name: 'Myth Busting',
    hookPattern: "Everyone believes [myth]. It's wrong.",
    shape: 'Myth, evidence, reveal',
    bridgePattern: 'The product applies the true version',
    example: '"Good writers write fast." They do not.',
    bestSet: 'neutral',
    mood: 'curious',
  },
  {
    id: 'one-number',
    name: 'The One Number',
    hookPattern: 'This one number [surprising effect]',
    shape: 'Stat, story behind it, implication',
    bridgePattern: 'The product moves that number',
    example: 'One unit mix-up cost NASA $125 million.',
    bestSet: 'office',
    mood: 'curious',
  },
  {
    id: 'courtroom',
    name: 'Courtroom / Exhibit',
    hookPattern: '"Exhibit A" evidence cards',
    shape: 'Mock trial of a bad habit',
    bridgePattern: 'The product is the verdict',
    example: 'The case against your last essay',
    bestSet: 'office',
    mood: 'chill',
  },
]

export const formatById = (id: string): Format => FORMATS.find((f) => f.id === id) ?? FORMATS[0]

/** Hook Score rubric: a rubric before it is a model. Weights sum to 100. */
export const HOOK_RUBRIC = [
  { key: 'visual', label: 'Visual hook', max: 25, checks: 'The first frame alone, with captions, makes you want the next frame' },
  { key: 'curiosity', label: 'Curiosity gap', max: 25, checks: 'An open question is posed and answered only late in the reel' },
  { key: 'specificity', label: 'Specificity', max: 15, checks: 'Names, numbers, places, not generic claims' },
  { key: 'relevance', label: 'Relevance to audience', max: 15, checks: "The story's world matches the buyer's world" },
  { key: 'bridge', label: 'Bridge strength', max: 20, checks: 'The pivot reuses a story element and states one concrete benefit' },
] as const
