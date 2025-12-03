/**
 * Create Initial Admin User
 *
 * Run this once to create your first superadmin user:
 *   node scripts/create-admin-user.js
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const bcrypt = require('bcrypt');
const { createClient } = require('@supabase/supabase-js');
const readline = require('readline');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

const ask = (q) => new Promise(resolve => rl.question(q, resolve));

async function createUser() {
  console.log('\n=== NextBid Create Admin User ===\n');

  const email = await ask('Email: ');
  const name = await ask('Name: ');
  const password = await ask('Password: ');
  const role = await ask('Role (viewer/operator/editor/admin/superadmin): ') || 'superadmin';

  // Hash password
  const saltRounds = 12;
  const passwordHash = await bcrypt.hash(password, saltRounds);

  // Insert user
  const { data, error } = await supabase
    .from('nextbid_users')
    .insert({
      email: email.toLowerCase(),
      password_hash: passwordHash,
      name,
      role,
      is_active: true
    })
    .select()
    .single();

  if (error) {
    console.error('\nError creating user:', error.message);
  } else {
    console.log('\n✓ User created successfully!');
    console.log(`  ID: ${data.id}`);
    console.log(`  Email: ${data.email}`);
    console.log(`  Name: ${data.name}`);
    console.log(`  Role: ${data.role}`);
  }

  rl.close();
}

createUser();
