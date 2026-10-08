# Exploding Fork

A fast multiplayer card-game simulator inspired by the push-your-luck chaos of party card games. It is an original game: **Exploding Fork**.

## Run
```
npm install
npm start
```

The server uses the same simple Express + static-PWA architecture as Quantum-fork and is ready for Render with `render.yaml`.

## Rules
- Create a room and share its 4-character code.
- 2–6 players can join.
- On your turn, play a utility card or draw.
- Drawing a Fork Bomb knocks you out unless you have a Shield.
- Last player standing wins.
- Game state is kept in memory, so restarting the server resets active rooms.
