process.env.JWT_SECRET = "test_secret_at_least_32_characters_long_123";
process.env.JWT_REFRESH_SECRET = "test_refresh_secret_at_least_32_chars_long_456";
process.env.NODE_ENV = "test";

const { MongoMemoryServer } = require("mongodb-memory-server");

(async () => {
  // Install mongodb-memory-server on the fly
  try { require.resolve("mongodb-memory-server"); }
  catch { console.log("installing mongodb-memory-server..."); 
    require("child_process").execSync("npm install mongodb-memory-server --no-audit --no-fund --loglevel=error", { stdio: "inherit" });
  }
  
  const mongoServer = await MongoMemoryServer.create();
  process.env.MONGODB_URI = mongoServer.getUri();
  
  const connectDB = require("./config/db");
  await connectDB();

  const Team = require("./models/Team");
  const User = require("./models/User");
  const teamService = require("./services/teamService");

  // Create owner + member
  const owner = await User.create({ name: "Owner", email: "owner@test.com", password: "Password123" });
  const member = await User.create({ name: "Member", email: "member@test.com", password: "Password123" });

  const team = await Team.create({
    name: "Test Team",
    ownerId: owner._id,
    members: [{ userId: member._id, role: "member", joinedAt: new Date() }],
  });

  console.log("\n=== Initial state ===");
  console.log("Member role:", team.members[0].role); // "member"

  // Toggle to admin
  console.log("\n=== Toggle 1: member → admin ===");
  await teamService.updateMemberRole(team._id, owner._id, member._id, "admin");
  const team2 = await Team.findById(team._id);
  console.log("Member role after toggle 1:", team2.members[0].role); // should be "admin"

  // Toggle back to member  
  console.log("\n=== Toggle 2: admin → member ===");
  await teamService.updateMemberRole(team._id, owner._id, member._id, "member");
  const team3 = await Team.findById(team._id);
  console.log("Member role after toggle 2:", team3.members[0].role); // should be "member"

  // Toggle to admin again
  console.log("\n=== Toggle 3: member → admin (again) ===");
  await teamService.updateMemberRole(team._id, owner._id, member._id, "admin");
  const team4 = await Team.findById(team._id);
  console.log("Member role after toggle 3:", team4.members[0].role); // should be "admin"

  await mongoServer.stop();
  process.exit(0);
})().catch(e => { console.error("❌", e.message, e.stack); process.exit(1); });
