# start.gg Set Counter

## Development
Clone the repo:
```
git clone https://github.com/jmlee337/sgg-set-counter.git sgg-set-counter
cd sgg-set-counter
```
At least Node 22 is required:
```
nvm use 22
npm install
```
Build and run:
```
npm run build && node build/src/main.js [SGG_API_KEY]
```

## Available Scripts

- `clean` - remove coverage data, cache and transpiled files,
- `prebuild` - lint source files and tests before building,
- `build` - transpile TypeScript to ES6,
- `build:watch` - interactive watch mode to automatically transpile source files,
- `lint` - lint source files and tests,
- `prettier` - reformat files,
- `test` - run tests,
- `test:watch` - interactive watch mode to automatically re-run tests
- `test:coverage` - run test and print out test coverage
