// Single source of truth for supported languages (used by server.js AND the UI)
const LANGS = {
  python: {
    label: 'Python', monaco: 'python', file: 'main.py', run: 'python3 main.py',
    template: 'print("Hello from CodeBox!")\n',
  },
  javascript: {
    label: 'JavaScript', monaco: 'javascript', file: 'main.js', run: 'node main.js',
    template: 'console.log("Hello from CodeBox!");\n',
  },
  cpp: {
    label: 'C++', monaco: 'cpp', file: 'main.cpp', run: 'g++ -std=c++17 -O1 -o main main.cpp && ./main',
    template: '#include <iostream>\n\nint main() {\n    std::cout << "Hello from CodeBox!" << std::endl;\n    return 0;\n}\n',
  },
  java: {
    label: 'Java', monaco: 'java', file: 'Main.java',
    run: 'java -XX:+UseSerialGC -XX:TieredStopAtLevel=1 Main.java',
    template: 'public class Main {\n    public static void main(String[] args) {\n        System.out.println("Hello from CodeBox!");\n    }\n}\n',
  },
  go: {
    label: 'Go', monaco: 'go', file: 'main.go', run: 'go run main.go',
    template: 'package main\n\nimport "fmt"\n\nfunc main() {\n\tfmt.Println("Hello from CodeBox!")\n}\n',
  },
};
module.exports = { LANGS, LANG_IDS: Object.keys(LANGS), DEFAULT_LANG: 'python' };
