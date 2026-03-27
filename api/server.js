import express from 'express';
import { Server } from 'socket.io';
import { createServer } from 'http';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import cors from 'cors';
import { v4 as uuidv4 } from 'uuid';

const app = express();
const server = createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

app.use(cors({ origin: true }));
app.use(express.json({ limit: '10mb' }));
app.use('/uploads', express.static('uploads'));

const DB_FILE = join(process.cwd(), 'db.json');
const UPLOADS_DIR = join(process.cwd(), 'uploads');
if (!existsSync(UPLOADS_DIR)) mkdirSync(UPLOADS_DIR, { recursive: true });

const loadDB = () => existsSync(DB_FILE) ? JSON.parse(readFileSync(DB_FILE, 'utf8')) : { users: [], messages: {} };
const saveDB = (db) => writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
let db = loadDB();
const rooms = ['general', 'random', 'coding'];

const JWT_SECRET = process.env.JWT_SECRET || 'blackchat-secret-2024';
const authenticateToken = (req, res, next) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) return res.status(401).json({ error: 'No token' });
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    res.status(403).json({ error: 'Invalid token' });
  }
};

// Email + Username Register
app.post('/register', async (req, res) => {
  const { email, username, password } = req.body;
  if (!email || !username || !password) return res.status(400).json({ error: 'All fields required' });
  
  if (db.users.find(u => u.email === email || u.username === username)) {
    return res.status(400).json({ error: 'Email or username taken' });
  }
  
  const hashed = await bcrypt.hash(password, 10);
  const user = {
    id: uuidv4(),
    email,
    username,
    password: hashed,
    bio: '',
    profilePic: 'https://ui-avatars.com/api/?name=' + username + '&background=5865f2&color=fff&size=128&bold=true'
  };
  
  db.users.push(user);
  saveDB(db);
  res.json({ success: true });
});

// Login with Email OR Username
app.post('/login', async (req, res) => {
  const { identifier, password } = req.body; // identifier = email OR username
  const user = db.users.find(u => u.email === identifier || u.username === identifier);
  
  if (!user || !await bcrypt.compare(password, user.password)) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }
  
  const token = jwt.sign({ id: user.id, username: user.username }, JWT_SECRET, { expiresIn: '7d' });
  res.json({ 
    token, 
    user: { 
      id: user.id, 
      email: user.email, 
      username: user.username, 
      bio: user.bio, 
      profilePic: user.profilePic 
    } 
  });
});

app.get('/profile/:username', (req, res) => {
  const user = db.users.find(u => u.username === req.params.username);
  res.json(user ? { username: user.username, bio: user.bio, profilePic: user.profilePic, email: user.email } : { error: 'User not found' });
});

app.get('/rooms', (req, res) => res.json(rooms));

// Socket.IO
io.on('connection', (socket) => {
  socket.on('joinRoom', (room) => socket.join(room));
  socket.on('chatMessage', ({ room, message, username }) => {
    const msg = { username, message, timestamp: Date.now(), room };
    db.messages[room] = db.messages[room] || [];
    db.messages[room].push(msg);
    if (db.messages[room].length > 100) db.messages[room] = db.messages[room].slice(-100);
    saveDB(db);
    socket.to(room).emit('message', msg);
  });
});

export default app;
