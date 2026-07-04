const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = 'https://awqnugwdknrpufiyilyd.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImF3cW51Z3dka25ycHVmaXlpbHlkIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4MzA1MDUyMywiZXhwIjoyMDk4NjI2NTIzfQ.9_Uw5T1AyNkP8TgA954DuDe43v8zBt5YmpXPpf-fwzM';

const supabase = createClient(supabaseUrl, supabaseKey);

async function run() {
  // Fetch projects
  const { data: projects, error: pErr } = await supabase.from('active_projects').select('project_id, project_name');
  if (pErr) {
    console.error('Error fetching projects:', pErr);
    return;
  }

  // Fetch team members
  const { data: members, error: mErr } = await supabase.from('team_members').select('dev_id, name');
  if (mErr) {
    console.error('Error fetching team members:', mErr);
    return;
  }

  console.log('Projects:', projects);
  console.log('Team Members:', members);

  if (projects.length === 0 || members.length === 0) {
    console.log('Cannot seed without projects or team members');
    return;
  }

  // Generate mock tasks
  const tasks = [
    {
      project_id: projects[0].project_id,
      assigned_dev_id: members[0].dev_id,
      task_title: 'Optimize Database Indexing',
      status: 'In Progress',
      priority: 'High',
      due_date: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString() // 3 days in future
    },
    {
      project_id: projects[0].project_id,
      assigned_dev_id: members[1].dev_id,
      task_title: 'Setup Redis Cache Clustering',
      status: 'Completed',
      priority: 'Medium',
      due_date: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString()
    },
    {
      project_id: projects[1].project_id,
      assigned_dev_id: members[2].dev_id,
      task_title: 'Resolve memory leak in SRE log pipeline',
      status: 'To Do',
      priority: 'Critical',
      due_date: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString() // OVERDUE
    },
    {
      project_id: projects[1].project_id,
      assigned_dev_id: members[3].dev_id,
      task_title: 'Configure automated rollbacks on health check failure',
      status: 'In Progress',
      priority: 'Critical',
      due_date: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString() // OVERDUE
    },
    {
      project_id: projects[2].project_id,
      assigned_dev_id: members[0].dev_id,
      task_title: 'Implement OAuth2 auth flow',
      status: 'To Do',
      priority: 'Medium',
      due_date: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString()
    },
    {
      project_id: projects[3].project_id,
      assigned_dev_id: members[1].dev_id,
      task_title: 'Refactor user registration tests',
      status: 'Completed',
      priority: 'Low',
      due_date: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString()
    }
  ];

  const { data: inserted, error: iErr } = await supabase.from('sprint_tasks').insert(tasks).select();
  if (iErr) {
    console.error('Error inserting tasks:', iErr);
  } else {
    console.log('Successfully inserted sprint tasks:', inserted.length);
  }
}

run();
