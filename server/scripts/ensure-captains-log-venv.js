const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const serverDir = path.resolve(__dirname, '..');
const venvDir = path.join(serverDir, '.venv');
const pythonBin =
  process.platform === 'win32'
    ? path.join(venvDir, 'Scripts', 'python.exe')
    : path.join(venvDir, 'bin', 'python');
const requirementsPath = path.join(serverDir, 'requirements-captains-log.txt');

function run(command, args) {
  console.log(`[captains-log-venv] ${command} ${args.join(' ')}`);
  execFileSync(command, args, {
    cwd: serverDir,
    stdio: 'inherit',
  });
}

function findSystemPython() {
  const candidates = process.platform === 'win32' ? ['py', 'python'] : ['python3', 'python'];

  for (const command of candidates) {
    try {
      execFileSync(command, ['--version'], {
        cwd: serverDir,
        stdio: 'ignore',
      });
      return command;
    } catch (_) {
      // Try the next common Python executable name.
    }
  }

  throw new Error('Could not find python3 or python to create Captain\'s Log virtual environment.');
}

if (!fs.existsSync(requirementsPath)) {
  throw new Error(`Captain's Log requirements file is missing: ${requirementsPath}`);
}

if (!fs.existsSync(pythonBin)) {
  const systemPython = findSystemPython();
  console.log(`[captains-log-venv] Creating virtual environment at ${path.relative(serverDir, venvDir)}`);
  run(systemPython, ['-m', 'venv', '.venv']);
} else {
  console.log(`[captains-log-venv] Reusing existing virtual environment at ${path.relative(serverDir, venvDir)}`);
}

run(pythonBin, ['-m', 'pip', 'install', '--upgrade', 'pip']);
run(pythonBin, ['-m', 'pip', 'install', '-r', 'requirements-captains-log.txt']);

console.log(`[captains-log-venv] Ready: ${path.relative(serverDir, pythonBin)}`);
