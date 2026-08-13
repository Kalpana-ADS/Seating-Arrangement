# Setup Guide — Step by Step

## Step 1: Install Node.js
1. Go to https://nodejs.org → Download LTS
2. Install → Verify: `node -v` and `npm -v`

## Step 2: Install MongoDB (Local)
### Windows
- Download MSI from https://www.mongodb.com/try/download/community
- Install as service → starts automatically

### Mac
```bash
brew tap mongodb/brew
brew install mongodb-community
brew services start mongodb-community
```

### Linux
```bash
sudo apt-get install -y mongodb
sudo systemctl start mongodb
```

## Step 3: Extract & Open Project
```bash
cd exam-seating-system
```
Open in VS Code: `code .`

## Step 4: Install Dependencies
```bash
npm install
```

## Step 5: Configure .env
Open `.env` and set:
```
MONGODB_URI=mongodb://localhost:27017/exam_seating
```

For MongoDB Atlas (cloud):
```
MONGODB_URI=mongodb+srv://user:pass@cluster.mongodb.net/exam_seating
```

## Step 6: Run
```bash
npm run dev        # Development (auto-restart)
npm start          # Production
```

## Step 7: First Run
On first start the system automatically:
- Creates 4 admin accounts
- Seeds 1,403 seating students (II/III/IV year, Sections A-H)
- Seeds 58 staff members for invigilator system
- Seeds 2,586 attendance students (II/III/IV year)

## Step 8: Open
- http://localhost:3000           → Student Portal
- http://localhost:3000/admin/login → Admin (admin/admin123)

## Troubleshooting

| Problem | Fix |
|---------|-----|
| MongoDB connection error | Run `mongod` or check Atlas URI |
| Port in use | Change PORT in .env |
| npm install fails | Use Node.js 16+ |
| Login not working | Default: admin/admin123 |
| Logo not showing | Upload at Admin → Settings |

## Git Commands
```bash
git init
git add .
git commit -m "Initial commit: PEC Exam System v3"
git remote add origin https://github.com/your/repo.git
git push -u origin main
```
