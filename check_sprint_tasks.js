const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = 'https://awqnugwdknrpufiyilyd.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImF3cW51Z3dka25ycHVmaXlpbHlkIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4MzA1MDUyMywiZXhwIjoyMDk4NjI2NTIzfQ.9_Uw5T1AyNkP8TgA954DuDe43v8zBt5YmpXPpf-fwzM';

const supabase = createClient(supabaseUrl, supabaseKey);

async function run() {
  const tables = ['active_projects', 'team_members', 'sprint_tasks', 'system_events'];
  for (const t of tables) {
    const { count, error } = await supabase.from(t).select('*', { count: 'exact', head: true });
    console.log(t, 'count:', count, 'error:', error);
  }
}

run();
