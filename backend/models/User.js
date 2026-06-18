const mongoose = require("mongoose");
const bcrypt   = require("bcryptjs");

const userSchema = new mongoose.Schema(
  {
    name: {
      type:      String,
      required:  [true, "Name is required"],
      trim:      true,
      minlength: [2,  "Name must be at least 2 characters"],
      maxlength: [60, "Name must be at most 60 characters"],
    },

    // unique:true already creates the index — no schema.index() needed
    email: {
      type:      String,
      required:  [true, "Email is required"],
      unique:    true,
      lowercase: true,
      trim:      true,
      match:     [/^\S+@\S+\.\S+$/, "Please enter a valid email address"],
    },

    password: {
      type:      String,
      required:  [true, "Password is required"],
      minlength: [8, "Password must be at least 8 characters"],
      select:    false,   // never returned in queries by default
    },

    refreshToken: {
      type:   String,
      select: false,
    },

    isActive: { type: Boolean, default: true },
    avatar:   { type: String,  default: null  },
    lastLoginAt: { type: Date },
  },
  {
    timestamps: true,
    toJSON:   { virtuals: true },
    toObject: { virtuals: true },
  }
);

// ─── FIX: hash password only when modified ────────────────────────────────────
// Bug that caused login failures: if save() was called with validateBeforeSave:false
// after updating refreshToken, the password field was sometimes re-hashed even though
// isModified("password") should have returned false.
// Extra guard: skip hashing if the value already looks like a bcrypt hash.
userSchema.pre("save", async function (next) {
  if (!this.isModified("password")) return next();
  // Safety net: don't double-hash
  if (this.password && this.password.startsWith("$2")) return next();

  const rounds  = parseInt(process.env.BCRYPT_ROUNDS, 10) || 12;
  this.password = await bcrypt.hash(this.password, rounds);
  next();
});

// ─── Instance: compare plain password against stored hash ────────────────────
userSchema.methods.comparePassword = async function (candidate) {
  // password has select:false — must be explicitly selected before calling this
  return bcrypt.compare(candidate, this.password);
};

// ─── Instance: safe public representation ────────────────────────────────────
userSchema.methods.toPublic = function () {
  return {
    id:          this._id,
    name:        this.name,
    email:       this.email,
    avatar:      this.avatar,
    createdAt:   this.createdAt,
    lastLoginAt: this.lastLoginAt,
  };
};

const User = mongoose.model("User", userSchema);
module.exports = User;
