-- Create users table for Le Guide multi-user auth
CREATE TABLE IF NOT EXISTS users (
  username           TEXT PRIMARY KEY,
  password_hash      TEXT NOT NULL,
  salt               TEXT NOT NULL,
  device_fingerprint TEXT DEFAULT NULL, -- locked to first device that logs in
  gemini_api_key     TEXT DEFAULT NULL, -- per-user Gemini API key
  created_at         TIMESTAMPTZ DEFAULT NOW()
);

-- If table already exists, add columns:
ALTER TABLE users ADD COLUMN IF NOT EXISTS device_fingerprint TEXT DEFAULT NULL;
ALTER TABLE users ADD COLUMN IF NOT EXISTS gemini_api_key TEXT DEFAULT NULL;

-- Insert 13 users (passwords hashed with scrypt, 64-byte output)
INSERT INTO users (username, password_hash, salt) VALUES
('Nimbus',   'c95485acb33d62792b331233ce27c2bae1d03bd204a757d33ff4e5cf5eaee55e90bf62c45cfaa2fb7b4fec2dd6f127aaf05db9f47b551ad5cdf1518885fcc328', '5478a9832631d1359f76b4cbe4f0ac2c'),
('Cumulus',  'd571ff5a951950b4945f1c1110f3ce09670134c9da8bdbf1e9da689d2c469d6cdfcd2aa8ef8abab04d842f4c3bf460f0f07bf32d17b8a5a3860993ded2b5d040', 'b49290492bb814e7900f0a7dec87e9df'),
('Vapor',    'df20683e85da57b2195fae24780c419ada4cd219fd81d897557455dad13d889c7f4a81c5a9d3e14cbcb8a7fbfd5a2f6193c6421542de029dc7facac17b416541', '14d3bc6b35f08b133328f439b420976d'),
('Mist',     '8f107998b212e1676289010f7a10b037748b7b9fe7454a3953397295006b3968b8b51a32049bb449f572a80fbccdce91980fc4f4851a67ed809637a61843393d', 'f51146b167bb7e4986f573059e8a0d78'),
('Haze',     '46468d404cd3da722d90cc289f28006fcf7003a5c611930589fbb27229d6235343b3c3b48c124280df2e9a7c50d456e9de9783ab59652eeb9e2bb16ccc3fac3b', '494b14b99c160f699e5f9da67da4047d'),
('Stratus',  '21dcab9ea37b8255fb8ebe3bb8c87a3ed133c9a03d87e6b8d2f811e86899f856c9f7790f286c2009b86cb533f5b73dab75882bf45faaa885f237c5c8b64bda63', 'ceb472c4eaecc9f4d8bbe95b9d3fba51'),
('Cirrus',   '4c63b57980c74d7a2417c0c9791e99b1dc24be8816f0d546f90c6e51c28b96d41a21841f112e93bd9fed73f21f07b9113dd4fdff9b12e58b2aced981fa21f26a', '269373d377ba098d231e7d841795d066'),
('Overcast', 'b5a000c7a2afe539312fccda4b73b2a5e6297cd41cbfc4a9792440896c1ed46b25a23e4dc22788cc29cd95292b8919347dfe14ccde6649e8bf266b3031874349', '16c3042d80e1adec04dc82fef07fb4ab'),
('Billow',   'f8efcb4b9c65c7711fa85995f1b3a4ea1631375ef4d628c1b01178ff4e3b12e6b8842ea97cce5df0df69fcc8bda39e4d44402175735fbf0d10a649c888d07e66', '408d290f40abe5d6e54fcd6aca9bafe6'),
('Murk',     'e0b3ce5a6f6e90fc7f46052b33b3bb923f84660669d7cd74a1e4409f733220366aefabb79b65eb65ad123af49f5f493b23a342a5003266b1038a843df38b1df4', '84f757bc4c528195b18fef4f895b8198'),
('Pall',     '32cf269eea10b86fce81a0878d74847d439fd013fbcf7c2f7aabed5863934be20f69343174ae843a7cac28e61ccd8367cea64aa77b9c2658056bf8686f935dd5', 'd74640d74d2066e950b4265dc32851b4'),
('Nebula',   'bb0bee83f107dc64a73fc860fa0de2c003dee3402195fbf6f54ec04f3cc02e089b25be02746b80e81ee58afdf7c230292878a4c58aed61f08145af9883593f80', '2d6b0d19ce35f1401f2176612665eb27'),
('Shroud',   '9e6c4df5fa8ab283b58424a128b59a6c89a24c9e5b8ce7586ac7f9bdb35454021faf668f94616e1c9288ae687042ff1ea6cb7080d188a913f05a34c0bd308b0a', '1bb7f25bee4974a450a144dd6eed0f57')
ON CONFLICT (username) DO NOTHING;
