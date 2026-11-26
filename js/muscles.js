// Muscle groups for the Body tab.
// exercises: built-in exercise ids. match: also list the user's own exercises whose names match.
// stretches: general guidance, not medical advice — ease in, never stretch into pain.

const H30 = '30 s each side';

export const MUSCLES = [
  {
    id: 'chest', name: 'Chest', about: 'Pectorals: push your arms forward and across your body.',
    exercises: ['ex_bench-press', 'ex_incline-bench-press', 'ex_dumbbell-bench-press', 'ex_incline-dumbbell-press', 'ex_chest-fly', 'ex_push-up', 'ex_dips'],
    match: /chest|pec|bench|fly|flye|push.?up|\bdips?\b/i,
    stretches: [
      { name: 'Doorway stretch', hold: '30 s', how: 'Forearms on a door frame, elbows at shoulder height. Step through slowly until you feel the stretch across the chest.' },
      { name: 'Hands-behind-back opener', hold: '30 s', how: 'Clasp hands behind you, straighten the arms and lift them gently while squeezing your shoulder blades together.' },
    ],
  },
  {
    id: 'shoulders', name: 'Shoulders', about: 'Deltoids: lift your arms forward, out to the side, and back.',
    exercises: ['ex_overhead-press', 'ex_dumbbell-shoulder-press', 'ex_lateral-raise', 'ex_rear-delt-fly', 'ex_face-pull'],
    match: /shoulder|delt|overhead press|military|lateral raise|arnold|face pull/i,
    stretches: [
      { name: 'Cross-body arm stretch', hold: H30, how: 'Bring one straight arm across your chest and hug it in with the other arm just above the elbow.' },
      { name: 'Sleeper stretch', hold: H30, how: 'Lie on your side, arm out at 90°, elbow bent up. Gently press the forearm toward the floor with the other hand.' },
    ],
  },
  {
    id: 'biceps', name: 'Biceps', about: 'Front of the upper arm: bend the elbow and turn the palm up.',
    exercises: ['ex_barbell-curl', 'ex_dumbbell-curl', 'ex_hammer-curl', 'ex_preacher-curl', 'ex_chin-up'],
    match: /bicep|curl/i, exclude: /leg curl|hamstring|wrist/i,
    stretches: [
      { name: 'Wall biceps stretch', hold: H30, how: 'Palm flat on a wall behind you at shoulder height, thumb up. Slowly turn your body away until you feel the front of the arm.' },
      { name: 'Seated reach-back', hold: '30 s', how: 'Sit with hands on the floor behind you, fingers pointing back. Slide your hips forward slowly, keeping arms straight.' },
    ],
  },
  {
    id: 'triceps', name: 'Triceps', about: 'Back of the upper arm: straighten the elbow; most of your arm size.',
    exercises: ['ex_tricep-pushdown', 'ex_skull-crusher', 'ex_overhead-tricep-extension', 'ex_dips', 'ex_push-up'],
    match: /tricep|push ?down|skull|\bdips?\b|close.grip|kickback/i,
    stretches: [
      { name: 'Overhead triceps stretch', hold: H30, how: 'Reach one hand down your upper back, elbow pointing up. Use the other hand to ease the elbow back.' },
      { name: 'Towel stretch', hold: H30, how: 'Hold a towel overhead behind your back with one hand, grab the bottom with the other and gently pull down.' },
    ],
  },
  {
    id: 'forearms', name: 'Forearms', about: 'Grip and wrist muscles: hold, squeeze, curl and extend the wrist.',
    exercises: ['ex_hammer-curl', 'ex_dead-hang', 'ex_deadlift', 'ex_shrug'],
    match: /forearm|wrist|grip|farmer|hammer|hang/i,
    stretches: [
      { name: 'Wrist flexor stretch', hold: H30, how: 'Arm straight in front, palm up. Gently pull the fingers back toward you with the other hand.' },
      { name: 'Wrist extensor stretch', hold: H30, how: 'Arm straight in front, palm down. Gently press the back of the hand so the fingers point to the floor.' },
    ],
  },
  {
    id: 'abs', name: 'Abs', about: 'Rectus abdominis: curl the trunk and brace the spine.',
    exercises: ['ex_plank', 'ex_hanging-leg-raise', 'ex_cable-crunch', 'ex_ab-wheel'],
    match: /\babs?\b|abdominal|crunch|sit.?up|leg raise|plank|core|hollow/i, exclude: /side plank/i,
    stretches: [
      { name: 'Cobra', hold: '20–30 s', how: 'Lie face down, hands under shoulders. Press up gently, keeping hips on the floor; stop before your lower back pinches.' },
      { name: 'Standing back bend', hold: '15 s', how: 'Hands on your lower back, lift your chest and lean back slightly while breathing slowly.' },
    ],
  },
  {
    id: 'obliques', name: 'Obliques', about: 'Sides of the waist: rotate and side-bend the trunk.',
    exercises: ['ex_side-plank', 'ex_hanging-leg-raise', 'ex_ab-wheel', 'ex_cable-crunch'],
    match: /oblique|twist|woodchop|side plank|side bend|pallof/i,
    stretches: [
      { name: 'Standing side bend', hold: H30, how: 'Reach one arm overhead and lean to the opposite side, keeping hips square.' },
      { name: 'Lying spinal twist', hold: H30, how: 'Lie on your back, drop both bent knees to one side and turn your head the other way, shoulders flat.' },
    ],
  },
  {
    id: 'traps', name: 'Traps', about: 'Trapezius: shrug the shoulders and steady the neck.',
    exercises: ['ex_shrug', 'ex_face-pull', 'ex_deadlift', 'ex_rear-delt-fly'],
    match: /trap|shrug|upright row/i,
    stretches: [
      { name: 'Ear-to-shoulder neck stretch', hold: H30, how: 'Tilt your ear toward one shoulder; lightly rest that hand on your head. Keep the other shoulder relaxed down.' },
      { name: 'Chin tuck & nod', hold: '20 s', how: 'Tuck your chin and gently lower it toward your chest until you feel the back of the neck lengthen.' },
    ],
  },
  {
    id: 'upperback', name: 'Upper back', about: 'Rhomboids and mid traps: pull the shoulder blades together.',
    exercises: ['ex_barbell-row', 'ex_dumbbell-row', 'ex_seated-cable-row', 'ex_t-bar-row', 'ex_face-pull', 'ex_rear-delt-fly'],
    match: /\brows?\b|rhomboid|rear delt|face pull|reverse fl/i, exclude: /rowing|upright/i,
    stretches: [
      { name: 'Hug-yourself stretch', hold: '30 s', how: 'Wrap your arms around your shoulders and round your upper back, pulling the shoulder blades apart.' },
      { name: 'Thread the needle', hold: H30, how: 'On hands and knees, slide one arm under your body along the floor and rest that shoulder down.' },
    ],
  },
  {
    id: 'lats', name: 'Lats', about: 'Latissimus dorsi: pull your arms down and back; gives the V-taper.',
    exercises: ['ex_pull-up', 'ex_chin-up', 'ex_lat-pulldown', 'ex_dumbbell-row', 'ex_barbell-row', 'ex_dead-hang'],
    match: /\blats?\b|pull.?up|chin.?up|pull.?down|pullover/i,
    stretches: [
      { name: 'Child’s pose reach', hold: '30 s', how: 'Kneel, sit back on your heels and walk your hands forward; walk them to one side to target each lat.' },
      { name: 'Overhead side reach', hold: H30, how: 'Hold a post or door frame overhead with both hands and sink your hips away from it.' },
    ],
  },
  {
    id: 'lowerback', name: 'Lower back', about: 'Spinal erectors: keep the spine upright and extend it.',
    exercises: ['ex_deadlift', 'ex_romanian-deadlift', 'ex_squat', 'ex_barbell-row'],
    match: /lower back|back extension|hyperextension|good morning|deadlift|superman/i,
    stretches: [
      { name: 'Knees to chest', hold: '30 s', how: 'Lie on your back and hug both knees toward your chest, letting the lower back relax into the floor.' },
      { name: 'Cat–cow', hold: '10 slow reps', how: 'On hands and knees, slowly round your back up, then let it sag gently as you lift your chest.' },
    ],
  },
  {
    id: 'glutes', name: 'Glutes', about: 'Gluteus muscles: extend and turn out the hip; your strongest muscles.',
    exercises: ['ex_hip-thrust', 'ex_squat', 'ex_romanian-deadlift', 'ex_bulgarian-split-squat', 'ex_lunge', 'ex_deadlift', 'ex_stairmaster'],
    match: /glute|hip thrust|bridge|kickback|abduct|split squat|lunge|step.?up/i,
    stretches: [
      { name: 'Figure-four stretch', hold: H30, how: 'Lie on your back, cross one ankle over the other knee and pull the bottom thigh toward you.' },
      { name: 'Pigeon', hold: H30, how: 'From all fours, bring one knee forward behind your wrist and slide the other leg back; lean forward gently.' },
    ],
  },
  {
    id: 'hipflexors', name: 'Hip flexors', about: 'Iliopsoas, sartorius and TFL: lift the knee and bend at the hip.',
    exercises: ['ex_hanging-leg-raise', 'ex_lunge', 'ex_bulgarian-split-squat', 'ex_running', 'ex_stairmaster'],
    match: /hip flex|psoas|leg raise|knee raise|mountain climber|sartorius/i,
    stretches: [
      { name: 'Kneeling hip-flexor stretch', hold: H30, how: 'Half-kneel, tuck your tailbone under and shift your hips forward until the front of the back hip stretches.' },
      { name: 'Couch stretch', hold: H30, how: 'Back knee on the floor against a wall or couch, shin up it; front foot planted. Stay tall and squeeze the back glute.' },
    ],
  },
  {
    id: 'quads', name: 'Quads', about: 'Front of the thigh: straighten the knee.',
    exercises: ['ex_squat', 'ex_front-squat', 'ex_leg-press', 'ex_leg-extension', 'ex_bulgarian-split-squat', 'ex_lunge', 'ex_wall-sit', 'ex_cycling'],
    match: /quad|squat|leg press|leg extension|lunge|step.?up|wall sit/i,
    stretches: [
      { name: 'Standing quad stretch', hold: H30, how: 'Hold a wall, pull one heel toward your glute and keep the knees together, hips pushed slightly forward.' },
      { name: 'Kneeling hip-flexor stretch', hold: H30, how: 'Half-kneel, tuck your tailbone and shift forward until the front of the back thigh stretches.' },
    ],
  },
  {
    id: 'hamstrings', name: 'Hamstrings', about: 'Back of the thigh: bend the knee and extend the hip.',
    exercises: ['ex_romanian-deadlift', 'ex_leg-curl', 'ex_deadlift', 'ex_bulgarian-split-squat', 'ex_hip-thrust'],
    match: /hamstring|leg curl|\brdl\b|romanian|good morning|nordic/i,
    stretches: [
      { name: 'Seated forward reach', hold: '30 s', how: 'Sit with one leg straight, other foot against that thigh. Hinge from the hips toward the straight leg’s toes.' },
      { name: 'Lying strap stretch', hold: H30, how: 'Lie on your back, loop a towel around one foot and raise the straight leg until you feel the back of the thigh.' },
    ],
  },
  {
    id: 'adductors', name: 'Adductors', about: 'Inner thigh: pull the legs together and steady the hips.',
    exercises: ['ex_squat', 'ex_lunge', 'ex_leg-press', 'ex_bulgarian-split-squat'],
    match: /adduct|inner thigh|sumo|copenhagen/i,
    stretches: [
      { name: 'Butterfly', hold: '30 s', how: 'Sit with the soles of your feet together, hold your ankles and let the knees drop toward the floor.' },
      { name: 'Side lunge stretch', hold: H30, how: 'Stand wide, bend one knee and shift your hips that way, keeping the other leg straight.' },
    ],
  },
  {
    id: 'calves', name: 'Calves', about: 'Gastrocnemius and soleus: point the foot; push off when you walk and run.',
    exercises: ['ex_calf-raise', 'ex_jump-rope', 'ex_running', 'ex_stairmaster', 'ex_walking'],
    match: /calf|calves|jump/i,
    stretches: [
      { name: 'Wall calf stretch', hold: H30, how: 'Hands on a wall, one foot back with the heel down and leg straight; lean in until the calf stretches.' },
      { name: 'Bent-knee calf stretch', hold: H30, how: 'Same as the wall stretch but bend the back knee slightly to reach the lower calf (soleus).' },
    ],
  },
];

export const musclesById = Object.fromEntries(MUSCLES.map((m) => [m.id, m]));
