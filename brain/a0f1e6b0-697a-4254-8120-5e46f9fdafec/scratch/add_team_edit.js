const fs = require('fs');

const filePath = 'f:\\z361\\src\\app\\page.tsx';
let content = fs.readFileSync(filePath, 'utf8');

// 1. Add state variables below the newTeamRole/isCreatingTeam state declaration
const newTeamState = `  const [newTeamRole, setNewTeamRole] = useState("Developer");
  const [isCreatingTeam, setIsCreatingTeam] = useState(false);`;

const editTeamState = `  const [newTeamRole, setNewTeamRole] = useState("Developer");
  const [isCreatingTeam, setIsCreatingTeam] = useState(false);

  // Edit Team Member Dialog State
  const [isEditTeamOpen, setIsEditTeamOpen] = useState(false);
  const [editingMember, setEditingMember] = useState<TeamMember | null>(null);
  const [editTeamName, setEditTeamName] = useState("");
  const [editTeamEmail, setEditTeamEmail] = useState("");
  const [editTeamGithub, setEditTeamGithub] = useState("");
  const [editTeamRole, setEditTeamRole] = useState("");
  const [isUpdatingTeam, setIsUpdatingTeam] = useState(false);`;

if (!content.includes(newTeamState)) {
  throw new Error("Could not locate newTeamState variables in page.tsx");
}
content = content.replace(newTeamState, editTeamState);

// 2. Add handlers below handleCreateTeamSubmit
const createTeamSubmit = `      } else {
        toast.error(data.error || "Failed to create team member.");
      }
    } catch (err) {
      toast.error("Network error creating team member.");
    } finally {
      setIsCreatingTeam(false);
    }
  };`;

const editHandlers = `      } else {
        toast.error(data.error || "Failed to create team member.");
      }
    } catch (err) {
      toast.error("Network error creating team member.");
    } finally {
      setIsCreatingTeam(false);
    }
  };

  const handleOpenEditMember = (member: TeamMember) => {
    setEditingMember(member);
    setEditTeamName(member.name);
    setEditTeamEmail(member.email_address);
    setEditTeamGithub(member.github_username || "");
    setEditTeamRole(member.role || "Developer");
    setIsEditTeamOpen(true);
  };

  const handleEditTeamSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingMember) return;
    if (!editTeamName.trim() || !editTeamEmail.trim()) {
      toast.error("Please fill in all required fields.");
      return;
    }

    try {
      setIsUpdatingTeam(true);
      const res = await fetch("/api/team", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          dev_id: editingMember.dev_id,
          name: editTeamName.trim(),
          email_address: editTeamEmail.trim(),
          github_username: editTeamGithub.trim() || null,
          role: editTeamRole.trim() || "Developer"
        })
      });
      const data = await res.json();
      if (res.ok) {
        toast.success(\`Team member '\${editTeamName}' updated successfully!\`);
        setIsEditTeamOpen(false);
        setEditingMember(null);
        setEditTeamName("");
        setEditTeamEmail("");
        setEditTeamGithub("");
        setEditTeamRole("");
        fetchTeam();
      } else {
        toast.error(data.error || "Failed to update team member.");
      }
    } catch (err) {
      toast.error("Network error updating team member.");
    } finally {
      setIsUpdatingTeam(false);
    }
  };`;

if (!content.includes(createTeamSubmit)) {
  throw new Error("Could not locate createTeamSubmit function end in page.tsx");
}
content = content.replace(createTeamSubmit, editHandlers);

// 3. Add edit button to TableCell actions in Team tab
const originalTableCell = `                              <TableCell>
                                <div className="flex items-center gap-2">
                                  {/* Assign to Project via chat */}`;

const updatedTableCell = `                              <TableCell>
                                <div className="flex items-center gap-2">
                                  {/* Edit member */}
                                  <button
                                    onClick={() => handleOpenEditMember(member)}
                                    className="text-[10px] px-2 py-1 rounded bg-[#3ecf8e] text-white hover:bg-[#34b27b] font-semibold transition-colors"
                                  >
                                    Edit
                                  </button>
                                  {/* Assign to Project via chat */}`;

if (!content.includes(originalTableCell)) {
  throw new Error("Could not locate originalTableCell in page.tsx");
}
content = content.replace(originalTableCell, updatedTableCell);

// 4. Add the Edit Dialog modal markup right before the last closing tags
const lastModalEnd = `      {/* ========================================================================= */}
      {/* 6. NEW TEAM MEMBER MODAL DIALOG                                           */}
      {/* ========================================================================= */}
      {isNewTeamOpen && (`;

// We will find a good insertion point for the Edit Dialog. Right above/below isNewTeamOpen.
const editModalMarkup = `      {/* ========================================================================= */}
      {/* 7. EDIT TEAM MEMBER MODAL DIALOG                                          */}
      {/* ========================================================================= */}
      {isEditTeamOpen && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white border border-[#e5e7eb] rounded-lg shadow-xl max-w-md w-full overflow-hidden animate-in fade-in zoom-in-95 duration-200">
            <div className="p-4 border-b border-[#e5e7eb] flex items-center justify-between bg-slate-50">
              <h3 className="font-bold text-slate-950 text-xs uppercase tracking-wider">Edit Team Member</h3>
              <button 
                onClick={() => setIsEditTeamOpen(false)}
                className="text-slate-400 hover:text-slate-600 p-1 flex items-center justify-center"
              >
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <form onSubmit={handleEditTeamSubmit} className="p-4 space-y-4">
              <div className="space-y-1.5">
                <label className="text-[10px] font-bold text-slate-400 uppercase">Full Name</label>
                <Input
                  required
                  placeholder="e.g. John Doe"
                  value={editTeamName}
                  onChange={(e) => setEditTeamName(e.target.value)}
                  className="bg-white border-[#e5e7eb] text-xs h-9 rounded text-black font-semibold"
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-[10px] font-bold text-slate-400 uppercase">Email Address</label>
                <Input
                  required
                  type="email"
                  placeholder="e.g. john.doe@company.com"
                  value={editTeamEmail}
                  onChange={(e) => setEditTeamEmail(e.target.value)}
                  className="bg-white border-[#e5e7eb] text-xs h-9 rounded text-black font-semibold"
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-[10px] font-bold text-slate-400 uppercase">GitHub Username</label>
                <Input
                  placeholder="e.g. johndoe-dev"
                  value={editTeamGithub}
                  onChange={(e) => setEditTeamGithub(e.target.value)}
                  className="bg-white border-[#e5e7eb] text-xs h-9 rounded text-black font-mono"
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-[10px] font-bold text-slate-400 uppercase">Role / Title</label>
                <Input
                  placeholder="e.g. Senior SRE, Backend Developer"
                  value={editTeamRole}
                  onChange={(e) => setEditTeamRole(e.target.value)}
                  className="bg-white border-[#e5e7eb] text-xs h-9 rounded text-black font-semibold"
                />
              </div>

              <div className="flex gap-2 pt-2 justify-end">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setIsEditTeamOpen(false)}
                  className="border-[#e5e7eb] text-xs h-9 font-semibold text-slate-700 bg-white hover:bg-slate-50"
                  disabled={isUpdatingTeam}
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  className="bg-[#3ecf8e] hover:bg-[#34b27b] text-white text-xs h-9 font-bold px-4"
                  disabled={isUpdatingTeam}
                >
                  {isUpdatingTeam ? "Updating..." : "Save Changes"}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* 6. NEW TEAM MEMBER MODAL DIALOG                                           */}
      {/* ========================================================================= */}
      {isNewTeamOpen && (`;

if (!content.includes(lastModalEnd)) {
  throw new Error("Could not locate lastModalEnd in page.tsx");
}
content = content.replace(lastModalEnd, editModalMarkup);

fs.writeFileSync(filePath, content, 'utf8');
console.log('Successfully updated page.tsx with team member editing features!');
