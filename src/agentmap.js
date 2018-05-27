/**
 * The namespace for the Agentmaps leaflet extension.
 * @namespace L.A
 */

(function(A) {
	if (typeof(L) === "undefined") {
		throw "L is undefined! Make sure that Leaflet.js is loaded.";
	}

	/**
	 * The main class for building, storing, simulating, and manipulating agent-based models on Leaflet maps.
	 *
	 * @class Agentmap
	 * @param {object} map - A Leaflet Map object.
	 * @property {object} map - A Leaflet Map object.
	 * @property {featureGroup} agents - A featureGroup containing all agents.
	 * @property {featureGroup} units - A featureGroup containing all units.
	 * @property {featureGroup} streets - A featureGroup containing all streets.
	 * @property {object} process_state - Properties detailing the state of the simulation process.
	 * @property {boolean} process_state.running - Whether the simulation is running or not.
	 * @property {boolean} process_state.paused - Whether the simulation is paused.
	 * @property {?number} process_state.animation_frame_id - The id of the agentmap's update function in the queue of functions to call for the coming animation frame.
	 * @property {?number} process_state.current_tick - The number of ticks elapsed since the start of the simulation.
	 * @property {?number} process_state.prev_tick - The tick (time in seconds) when the last update was started.
	 * @property {?number} process_state.tick_start_delay - Ticks corresponding to the time of the last animation frame before the trip started. Subtracted from all subsequent tick measurements so that the clock starts at 0, instead of whatever the actual time of that initial animation frame was.
	 * @property {object} settings - Settings for the agentmap, filled with defaults.
	 * @property {number} settings.movement_precision - On each interval of this many miliseconds between requestAnimationFrame calls, the agent's movements will be updated (for more precise movements than just updating on each call to requestAnimationFrame (60 fps max).
	 * @property {?function} update_func - Function to be called on each update.
	 */
	Agentmap = function (map) {
		this.map = map,
		this.units = null,
		this.streets = null,
		this.agents = null, 
		this.process_state = {
			running: false,
			paused: false,
			animation_frame_id: null,
			current_tick: null,
			prev_tick: null,
			tick_start_delay: null
		},
		this.settings = {
			movement_precision: .001
		},
		this.update_func = function() {};
	};

	/**
	 * Get an animation frame, have the agents update & get ready to be drawn, and keep doing that until paused or reset.
	 */
	Agentmap.prototype.run = function() {
		if (this.process_state.running === false) {
			this.process_state.running = true;
			
			let animation_update = (function (rAF_time) {
				this.update(rAF_time);
				
				this.process_state.animation_frame_id = requestAnimationFrame(animation_update);
			}).bind(this);

			this.animation_frame_id = requestAnimationFrame(animation_update);
		}
	}

	/**
	 * Update the simulation at the given time.
	 *
	 * @param {number} rAF_time - Time passed by the browser's most recent animation frame.
	 */
	Agentmap.prototype.update = function(rAF_time) {
		let total_ticks = rAF_time * .001,
		tick_at_pause = 0,
		ticks_since_paused = 0;
		
		if (this.process_state.current_tick === null) {
			this.process_state.current_tick = 0,
			this.process_state.prev_tick = 0,

			//requestAnimationFrame doesn't start with timestamp 0; the first timestamp will typically be pretty large; 
			//we want to store it and subtract it from each newly recieved tick at which we're animating so that ticks 
			//are counted from 0, not whatever timestamp the original call to rAF happened to return. 
			this.process_state.tick_start_delay = total_ticks;
		}
		else {
			if (this.process_state.paused) {
				tick_at_pause = this.process_state.current_tick;
				this.process_state.paused = false;
			}
			
			//See the comment immediately above.
			this.process_state.current_tick = total_ticks - this.process_state.tick_start_delay;
			ticks_since_paused = this.process_state.paused ? this.process_state.current_tick - tick_at_pause : 0;
			this.process_state.current_tick -= ticks_since_paused;
			this.process_state.tick_start_delay += ticks_since_paused;
		}

		this.update_func();

		let movement_precision = this.settings.movement_precision,
		animation_tick_interval = this.process_state.current_tick - this.process_state.prev_tick,
		steps_inbetween = Math.floor(animation_tick_interval / movement_precision);

		this.agents.eachLayer(function(agent) {
			agent.update(animation_tick_interval, movement_precision, steps_inbetween);
		});

		this.process_state.prev_tick = this.process_state.current_tick;
	};

	/**
	* Stop the animation, reset the animation state properties, and delete the agents.
	*/
	Agentmap.prototype.reset = function() {
		cancelAnimationFrame(this.process_state.animation_frame_id);
		this.process_state.running = false,
		this.process_state.paused = false,
		this.process_state.animation_frame_id = null,
		this.process_state.current_tick = null,
		this.process_state.prev_tick = null,
		this.process_state.tick_start_delay = null;

		for (agent of this.agents) {
			agent.delete();
		}
	};

	/** 
	 * Stop the animation, stop updating the agents.
	 */
	Agentmap.prototype.pause = function() {
		cancelAnimationFrame(this.process_state.animation_frame_id);
		this.process_state.running = false,
		this.process_state.paused = true;
	};

	/**
	 * Get a point through which an agent can exit/enter a unit.
	 *
	 * @param {number} unit_id - The unique id of the unit whose door you want.
	 * @returns {LatLng} - The coordinates of the center point of the segment of the unit parallel to the street.
	 */
	Agentmap.prototype.getUnitDoor = function(unit_id) {
		let unit = this.units.getLayer(unit_id),
		unit_spec = unit.getLatLngs()[0],
		side_a = unit_spec[0],
		side_b = unit_spec[1],
		door = 	L.latLngBounds(side_a, side_b).getCenter();
		
		return door;
	};

	/**
	 * Get the point on the adjacent street in front of the unit's door.
	 *
	 * @param {number} unit_id - The unique id of the unit whose door's corresponding point on the street you want.
	 * @returns {LatLng} - The coordinates point of the adjacent street directly in front of unit's door.
	 */
	Agentmap.prototype.getStreetNearDoor = function(unit_id) {
		let unit = this.units.getLayer(unit_id),
		unit_anchors = A.reversedCoordinates(unit.street_anchors),
		street_point = L.latLngBounds(...unit_anchors).getCenter();
		
		return street_point;
	};

	function agentmapFactory(map) {
		return new A.Agentmap(map);
	}
	
	A.Agentmap = Agentmap,
	A.agentmap = agentmapFactory;
}(L.A = L.A || {}));
