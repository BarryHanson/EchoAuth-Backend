# EchoAuth - License & Cheat Management Backend

A production-ready REST API built with Node.js, Express, TypeScript, and Prisma for managing authentication, license keys, cheats, and user subscriptions with advanced security features.

## Features

- 🔐 **JWT Authentication** - Secure token-based authentication with HMAC-SHA256 response signing
- 🗝️ **Multi-Tenant Architecture** - Separate roles: God (admin), Owner (program creator), Seller (reseller)
- 🔑 **Key Management** - Generate, validate, ban, and manage license keys per owner
- 🎮 **Cheat Management** - Create and manage cheat definitions with independent HWID/IP locking
- 💾 **Subscription System** - Track user subscriptions and billing periods
- 📊 **Logging & Analytics** - Track all client activities, API calls, and errors
- 🚫 **Ban System** - HWID, key, and user banning with reasons and expiration
- 📁 **Secure File Distribution** - XOR-encrypted cheat file delivery
- 🛡️ **Advanced Security**:
  - HMAC-SHA256 response signature verification
  - XOR symmetric encryption for cheat modules
  - Hardware ID (HWID) session locking
  - IP address locking
  - Timestamp drift detection (clock tampering prevention)
  - Rate limiting (configurable per endpoint)
- 🔒 **Input Validation** - Express-validator middleware on all endpoints
- 📝 **Comprehensive Logging** - Built-in logger for debugging and monitoring

## Architecture

### Role-Based Access Control
- **God**: System administrator with full access
- **Owner**: Can create/manage programs and generate API keys
- **Seller**: Can resell licenses for specific programs (via Owner)
- **User**: End client using cheats/programs

### Security Model
- Clients authenticate with API Key + HWID
- All responses signed with HMAC-SHA256 using API secret
- Cheat modules encrypted with XOR (configurable per cheat)
- Sessions locked to specific HWID and/or IP address
- Timestamp validation to detect clock tampering (±5 second drift)
- Rate limiting: Auth (10/15min), Keys (50/hour), Downloads (100/hour), General (200/minute)

## Prerequisites

- Node.js 16+
- npm or yarn
- MySQL 5.7+

## Installation

1. Clone the repository:
```bash
cd backend
```

2. Install dependencies:
```bash
npm install
```

3. Create `.env` file from `.env.example`:
```bash
cp .env.example .env
```

4. Update `.env` with your configuration:
```
DATABASE_URL="mysql://root:password@localhost:3306/echoauth"
JWT_SECRET="your-secure-secret-key-min-32-chars"
PORT=3001
NODE_ENV=development
CORS_ORIGIN="http://localhost:3000"
```

5. Generate Prisma client and run migrations:
```bash
npm run prisma:generate
npm run prisma:migrate
```

## Development

Start the development server:
```bash
npm run dev
```

The API will be available at `http://localhost:3001`

## Building

Build for production:
```bash
npm run build
```

Start production server:
```bash
npm start
```

## API Endpoints

### Authentication (`/api/auth`)
- `POST /api/auth/register` - Register new user
- `POST /api/auth/login` - Login and get JWT token (24h expiry)
- `GET /api/auth/me` - Get current user info (requires JWT)
- `POST /api/auth/change-password` - Change password (requires JWT)

### Client APIs (`/api/client`)
- `POST /api/client/auth` - Authenticate API key with HWID (requires Key + HWID)
- `POST /api/client/download` - Download encrypted cheat file
- `POST /api/client/loader/check-version` - Check for loader updates
- `POST /api/client/log` - Submit client logs and telemetry

### Admin APIs (`/api/admin`)
- `POST /api/admin/keys/generate` - Generate new API keys for owners
- `GET /api/admin/keys` - List all keys (with filters)
- `POST /api/admin/keys/ban` - Ban a key
- `DELETE /api/admin/keys/ban/:id` - Unban a key
- `POST /api/admin/cheats` - Create new cheat
- `GET /api/admin/cheats` - List all cheats
- `PUT /api/admin/cheats/:id` - Update cheat settings
- `PUT /api/admin/cheats/:id/status` - Update cheat status (Detected/Undetected)
- `POST /api/admin/cheats/:id/file` - Upload cheat file
- `GET /api/admin/logs` - View system logs
- `GET /api/admin/bans` - List all HWID/IP bans
- `POST /api/admin/bans` - Ban HWID/IP
- `DELETE /api/admin/bans/:id` - Unban HWID/IP
- `GET /api/admin/stats` - Get system statistics

### Owner APIs (`/api/owner`)
- `GET /api/owner/keys` - List keys owned by this owner
- `POST /api/owner/cheats` - Create new cheat
- `GET /api/owner/cheats` - List owner's cheats
- `PUT /api/owner/cheats/:id` - Update cheat settings
- `POST /api/owner/cheats/:id/file` - Upload cheat file
- `GET /api/owner/users` - List users subscribed to owner's cheats
- `GET /api/owner/stats` - Get owner's statistics

### Registration APIs (`/api/register`)
- `POST /api/register/key` - Request registration with API key
- `POST /api/register/verify` - Verify registration and create account
- `POST /api/register/seller` - Upgrade to seller (requires owner approval)

## Project Structure

```
src/
├── controllers/         # Request handlers and business logic
│   ├── auth.ts
│   ├── admin.ts
│   ├── owner.ts
│   ├── client.ts
│   ├── registration.ts
│   └── userSubscription.ts
├── services/           # Core business logic
│   ├── auth.ts
│   ├── key.ts
│   ├── cheat.ts
│   ├── ban.ts
│   ├── log.ts
│   ├── session.ts
│   ├── user.ts
│   └── cheatFile.ts
├── middleware/         # Express middleware
│   ├── auth.ts         # JWT verification
│   ├── validation.ts   # Input validation
│   └── errorHandler.ts # Error handling
├── routes/            # API route definitions
│   ├── auth.ts
│   ├── admin.ts
│   ├── owner.ts
│   ├── client.ts
│   └── registration.ts
├── utils/            # Utility functions
│   ├── encryption.ts  # XOR encryption/decryption
│   ├── logger.ts      # Logging system
│   └── crypto.ts      # HMAC-SHA256 signing
├── types/            # TypeScript type definitions
└── index.ts          # Application entry point
```

## Environment Variables

- `DATABASE_URL` - MySQL connection string
- `JWT_SECRET` - Secret key for JWT tokens (min 32 characters)
- `PORT` - Server port (default: 3001)
- `NODE_ENV` - Environment mode (development/production)
- `CORS_ORIGIN` - CORS allowed origin(s)

## Database Schema

Managed via Prisma ORM. Key models:

- **User** - Admin users with roles (God, Owner, Seller)
- **Key** - API keys with owner association and subscription info
- **Cheat** - Cheat definitions with status (Detected/Undetected)
- **CheatFile** - Encrypted cheat file binary data
- **Session** - User sessions with HWID/IP locking
- **UserSubscription** - User subscriptions to specific cheats
- **Ban** - HWID/key bans with reasons and expiration
- **Log** - Audit trail of all API activities
- **Loader** - Loader version information

## Security Features

### Authentication & Authorization
- JWT tokens with configurable expiry (default 24 hours)
- HMAC-SHA256 response signatures for all API responses
- Role-based access control (RBAC)
- API key validation against database

### Data Protection
- XOR symmetric encryption for cheat module transport
- Password hashing with bcrypt (salt rounds: 10)
- Secure memory handling (sensitive data cleared after use)
- SQL injection prevention via Prisma ORM

### Session Security
- Hardware ID (HWID) locking - binds session to specific machine
- IP address locking - optionally restricts to specific IP
- Timestamp validation - detects clock tampering (±5 second drift)
- Configurable per-cheat locking (independent HWID/IP toggles)

### Request Validation
- All endpoints validate input with express-validator
- Type-safe with TypeScript
- CORS protection

### Rate Limiting
- Authentication: 10 requests per 15 minutes
- Key generation: 50 requests per hour
- Cheat downloads: 100 requests per hour
- General APIs: 200 requests per minute

## Response Format

All API responses follow a standard format:

```json
{
  "success": true,
  "message": "Operation successful",
  "data": {},
  "signature": "base64-encoded-hmac-sha256"
}
```

**Signature Verification** (client-side):
- All responses include HMAC-SHA256 signature
- Clients must verify signature using the API secret
- If signature verification fails, reject the response

## Error Codes

- `400` - Bad Request (validation failed)
- `401` - Unauthorized (invalid/missing JWT or API key)
- `403` - Forbidden (insufficient permissions)
- `404` - Not Found
- `429` - Rate Limited (too many requests)
- `500` - Internal Server Error

## Docker

Build and run with Docker:

```bash
docker-compose up
```

## Development Tips

1. **Database Seeding** - Use Prisma Studio to view/edit data:
   ```bash
   npx prisma studio
   ```

2. **Logging** - All logs go to `logs/` directory with date-based filenames

3. **Testing** - Run integration tests:
   ```bash
   npm run test
   ```

4. **Migrations** - Create new migrations after schema changes:
   ```bash
   npx prisma migrate dev --name description
   ```

## License

Proprietary - EchoAuth
