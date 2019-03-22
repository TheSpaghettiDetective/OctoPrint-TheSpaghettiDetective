import threading
import re

class Commander:

    def __init__(self):
        self.mutex = threading.RLock()
        self.saved_temps = {}
        self.last_g9x = 'G90'
        self.last_m8x = 'M82'
        self.job_is_on_hold = False

    def track_gcode(self, comm_instance, phase, cmd, cmd_type, gcode, subcode=None, tags=None, *args, **kwargs):
        if 'TSD' in tags:
            return

        with self.mutex:
            if re.match('G9[01]', cmd, flags=re.IGNORECASE):
                self.last_g9x = cmd
                print('commander setting: {}'.format(self.last_g9x))
            if re.match('M8[23]', cmd, flags=re.IGNORECASE):
                self.last_m8x = cmd
                print('commander setting: {}'.format(self.last_m8x))

    def put_on_hold(self, printer):
        with self.mutex:
            printer.set_job_on_hold(True)
            self.job_is_on_hold = True

        self.commands(printer, [
            'G91',
            'M83',
            'G1 E-5.0',
            'G1 Z5.0',
            ])

    def resume_from_hold(self, printer):
        self.commands(printer, [
            'G91',
            'M83',
            'G1 Z-5.0',
            'G1 E5.0',
            self.last_g9x,
            self.last_m8x,
            ])

        with self.mutex:
            printer.set_job_on_hold(False)
            self.job_is_on_hold = False


    def release_hold_if_needed(self, printer):
        with self.mutex:
            if self.job_is_on_hold:
                self.commands(printer, [
                    self.last_g9x,
                    self.last_m8x,
                    ])
                printer.set_job_on_hold(False)
                self.job_is_on_hold = False


    def set_temps(self, printer, heater=None, target=None, save=False):
        current_temps = printer.get_current_temperatures()

        if heater == 'tools':
            for tool_heater in [h for h in current_temps.keys() if h.startswith('tool')]:
                if save:
                    with self.mutex:
                        self.saved_temps[tool_heater] = current_temps[tool_heater]
                printer.set_temperature(tool_heater, target)

        elif heater == 'bed' and current_temps.get('bed'):
            if save:
                with self.mutex:
                    self.saved_temps['bed'] = current_temps.get('bed')
            printer.set_temperature('bed', target)

    def restore_temps(self, printer):
        cmds = []

        with self.mutex:
            if 'bed' in self.saved_temps:
                target_temp = int(self.saved_temps['bed']['target'] + self.saved_temps['bed']['offset'])
                cmds.append('M190 S%d' % (target_temp))

            if 'tool1' in self.saved_temps:  # Multiple hotends
                for tool_num in range(3):  # most 3 hotends, I guess?
                    heater = 'tool%d' % tool_num
                    if heater in self.saved_temps:
                        target_temp = self.saved_temps[heater]['target'] + self.saved_temps[heater]['offset']
                        cmds.append('M109 T%d S%d' % (tool_num, target_temp))
            else:
                heater = 'tool0'
                if heater in self.saved_temps:
                    target_temp = self.saved_temps[heater]['target'] + self.saved_temps[heater]['offset']
                    cmds.append('M109 S%d' % (target_temp))

            self.saved_temps = {}

        if len(cmds) == 0:
            return

        self.commands(printer, cmds)


    # private methods

    def commands(self, printer, cmds):
        printer.commands(cmds, tags=set(['TSD']))
