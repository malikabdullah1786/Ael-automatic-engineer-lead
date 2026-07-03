const fs = require('fs');

const filePath = 'f:\\z361\\src\u002Fapp\u002Fpage.tsx';
let content = fs.readFileSync(filePath, 'utf8');

// 1. Replace main element
content = content.replace(
  '<main className="flex-1 flex flex-col min-h-0 p-6 relative bg-[#f9fafb]">',
  '<main className={`flex-1 flex flex-col min-h-0 p-6 relative bg-[#f9fafb] ${activeTab === "chat" ? "overflow-hidden" : "overflow-y-auto"}`}>\n            {/* Custom scroll support applied dynamically */}'
);

// 2. Replace activeTab === "projects" container
content = content.replace(
  '            {activeTab === "projects" && (\n              <div className="flex-1 min-h-0 flex flex-col space-y-6 overflow-y-auto pr-1">',
  '            {activeTab === "projects" && (\n              <div className="flex flex-col space-y-6 pr-1">'
);

// 3. Replace activeTab === "team" container and inner table wrapper
content = content.replace(
  '            {activeTab === "team" && (\n              <div className="flex-1 min-h-0 flex flex-col space-y-5 bg-white border border-[#e5e7eb] rounded-lg p-5 shadow-sm overflow-hidden">',
  '            {activeTab === "team" && (\n              <div className="flex flex-col space-y-5 bg-white border border-[#e5e7eb] rounded-lg p-5 shadow-sm">'
);

content = content.replace(
  '                <div className="flex-1 overflow-y-auto">',
  '                <div>'
);

// 4. Replace activeTab === "integrations" container
content = content.replace(
  '            {activeTab === "integrations" && (\n              <div className="flex-1 min-h-0 overflow-y-auto space-y-6">',
  '            {activeTab === "integrations" && (\n              <div className="space-y-6">'
);

// 5. Replace activeTab === "usage" container
content = content.replace(
  '            {activeTab === "usage" && (\n              <div className="flex-1 min-h-0 overflow-y-auto space-y-5">',
  '            {activeTab === "usage" && (\n              <div className="space-y-5">'
);

// 6. Replace activeTab === "settings" container
content = content.replace(
  '            {activeTab === "settings" && (\n              <div className="flex-1 min-h-0 overflow-y-auto space-y-6">',
  '            {activeTab === "settings" && (\n              <div className="space-y-6">'
);

fs.writeFileSync(filePath, content, 'utf8');
console.log('Successfully applied scrollable layout improvements to page.tsx!');
